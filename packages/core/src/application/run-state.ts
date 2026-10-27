import {
	type EngineError,
	err,
	type ModelRef,
	ok,
	type Result,
	ShellConfigSchema,
	shellName,
	type ToolContext,
} from "@mete/contracts";
import type {
	ConfigInvalid,
	ConfigReader,
	EventBus,
	Logger,
} from "@mete/kernel";
import { transition } from "xstate";
import { handoffBody } from "../domain/handoff.js";
import type { Platform } from "../domain/prompt.js";
import { type EventBody, runEventOf } from "../domain/run-events.js";
import {
	type RunEvent,
	type RunSnapshot,
	runMachine,
} from "../domain/run-machine.js";
import type { ArtifactStore } from "../infrastructure/artifact-store.js";
import type { HandoffStore } from "../infrastructure/handoff-store.js";
import type { RunMeta, RunStore } from "../infrastructure/run-store.js";
import type { SnapshotStore } from "../infrastructure/snapshot-store.js";
import type { TemplateDirs } from "../infrastructure/template-store.js";
import type { StepDeps } from "./steps.js";

// The engine's state and the primitives every driver uses: apply an event, publish, hold a run.

/** What the engine works with; the module builds it from its context. */
export type EngineDeps = StepDeps & {
	readonly workspaceId: string;
	readonly events: EventBus;
	readonly config: ConfigReader;
	readonly logger: Logger;
	readonly store: RunStore;
	readonly newId: () => string;
	readonly setTimer: (fn: () => void, ms: number) => () => void;
	/** The operating system as shell.exec@1 reports it, and process.platform. */
	readonly os: string;
	readonly platform: string;
	/** Where team templates are read from; no folders means team runs are not supported. */
	readonly templates?: TemplateDirs | undefined;
	/** Where team runs keep their artifacts; without it none are written. */
	readonly artifacts?: ArtifactStore | undefined;
	/** Where runs leave their handoffs (docs/07); without it none are written. */
	readonly handoffs?: HandoffStore | undefined;
	/** Where file snapshots go in a folder without git (ADR-080); without it none are made. */
	readonly snapshots?: SnapshotStore | undefined;
};

/**
 * One run held in memory. `token` names the drive loop that owns it; `loop` settles when
 * that loop stops, so a resumed run starts only after a tool call in flight finished.
 */
export type Live = {
	meta: RunMeta;
	snapshot: RunSnapshot;
	token: object;
	loop: Promise<void>;
	all: AbortController;
	model?: AbortController | undefined;
	cancelTimer?: (() => void) | undefined;
	/** The preferred model or pin read for the agent seated now (ADR-122). */
	pin?:
		| {
				readonly key: string;
				readonly revision?: number | undefined;
				readonly prefer: ModelRef | undefined;
		  }
		| undefined;
};

/** The engine's state: its dependencies, the runs in memory and how a quota timer resumes. */
export type EngineState = {
	readonly deps: EngineDeps;
	readonly live: Map<string, Live>;
	readonly onPauseEnded: (runId: string) => void;
};

// setTimeout fires at once above 2^31 - 1 ms.
const MAX_DELAY_MS = 2_147_483_647;

export const iso = (ms: number) => new Date(ms).toISOString();

// A row whose snapshot cannot be read is not_found, so callers answer instead of throwing.
export const loaded = (s: EngineState, runId: string) => {
	try {
		return ok(s.deps.store.load(runId));
	} catch (e) {
		const why = e instanceof Error ? e.name : "error";
		return err<EngineError>({
			code: "not_found",
			message: `run ${runId} cannot be read (${why})`,
		});
	}
};

// A run's snapshot without taking it into the engine: the live one, else its row (ADR-125).
export const peek = (
	s: EngineState,
	runId: string,
): Result<RunSnapshot, EngineError> => {
	const held = s.live.get(runId);
	if (held) return ok(held.snapshot);
	const row = loaded(s, runId);
	if (!row.ok) return row;
	if (!row.value) return err({ code: "not_found", message: `no run ${runId}` });
	return ok(row.value.snapshot);
};

/** What a tool call of the run's active agent carries: the run, its agent, the taint, its task's worktree and the stop signal. */
export const toolContext = (l: Live): ToolContext => {
	const agent = l.snapshot.context.agent;
	const ids = agent ? { agentId: agent.id } : {};
	const taint = l.snapshot.context.tainted ? { tainted: true } : {};
	const { task, team } = l.snapshot.context;
	const tree = task ? team?.tasks[task]?.context.worktree : undefined;
	const cwd = tree ? { cwd: tree } : {};
	return { runId: l.meta.id, ...ids, ...taint, ...cwd, signal: l.all.signal };
};

/** The operating system and the shell shell.exec@1 runs, as the prompts name them (docs/08). */
export const platformOf = (s: EngineState): Result<Platform, ConfigInvalid> => {
	const shell = s.deps.config.get("shell", ShellConfigSchema);
	if (!shell.ok) return shell;
	return ok({ os: s.deps.os, shell: shellName(shell.value, s.deps.platform) });
};

/** Publishes an event of the run, of one of its tasks when `taskId` is given. */
export const emit = (
	s: EngineState,
	l: Live,
	body: EventBody,
	taskId?: string,
) => {
	const agent = l.snapshot.context.agent;
	s.deps.events.publish({
		id: s.deps.newId(),
		ts: iso(s.deps.now()),
		schema: 1,
		workspaceId: s.deps.workspaceId,
		runId: l.meta.id,
		...(taskId ? { taskId } : {}),
		...(agent ? { agentId: agent.id } : {}),
		source: "core-engine",
		...body,
	});
};

export const clearTimer = (l: Live) => {
	l.cancelTimer?.();
	l.cancelTimer = undefined;
};

// A quota or network pause ends by itself at its `resumesAt`; any other pause waits for a person.
const selfResuming = (reason: string | undefined) =>
	reason === "quota" || reason === "network";

const armTimer = (s: EngineState, l: Live, resumesAt: string) => {
	const wait = Math.max(0, Date.parse(resumesAt) - s.deps.now());
	l.cancelTimer = s.deps.setTimer(
		() => {
			l.cancelTimer = undefined;
			const c = l.snapshot;
			if (c.value !== "paused" || !selfResuming(c.context.pause?.reason))
				return;
			// Another process may have cancelled the run meanwhile (mete stop); the row decides.
			if (s.deps.store.list(l.meta.id)[0]?.status === "paused")
				s.onPauseEnded(l.meta.id);
		},
		Math.min(wait, MAX_DELAY_MS),
	);
};

// A run leaves a handoff when it ends, or pauses for anything but quota or network (docs/08, Run memory);
// that includes the user pauses of stop() and recovery, as the rule says.
const handoffDue = (body: EventBody) =>
	body.type === "run.completed" ||
	body.type === "run.failed" ||
	body.type === "run.cancelled" ||
	(body.type === "run.paused" && !selfResuming(body.payload.reason));

// A handoff that cannot be written never fails the run; it is logged with the run id.
const leaveHandoff = (s: EngineState, l: Live) => {
	const store = s.deps.handoffs;
	if (!store) return;
	const id = s.deps.newId();
	try {
		const body = handoffBody(l.snapshot.context, l.snapshot.value);
		const at = iso(s.deps.now());
		const row = {
			id,
			workspaceId: l.meta.workspaceId,
			runId: l.meta.id,
			body,
			createdAt: at,
		};
		store.write(row);
	} catch (e) {
		s.deps.logger.error({ err: e, runId: l.meta.id }, "handoff not written");
		return;
	}
	emit(s, l, { type: "handoff.created", payload: { handoffId: id } });
};

/** Applies one event; the row is written before the event is published (docs/07). */
export const apply = (s: EngineState, l: Live, event: RunEvent) => {
	if (!l.snapshot.can(event)) return false;
	const prev = l.snapshot;
	const [next] = transition(runMachine, prev, event);
	s.deps.store.save(l.meta, next);
	l.snapshot = next;
	const body = runEventOf(prev, next);
	if (body) emit(s, l, body);
	if (body && handoffDue(body)) leaveHandoff(s, l);
	if (event.type === "PAUSE" && event.resumesAt)
		armTimer(s, l, event.resumesAt);
	return true;
};

/** Holds a run in memory. */
export const hold = (s: EngineState, meta: RunMeta, snapshot: RunSnapshot) => {
	const l: Live = {
		meta,
		snapshot,
		token: {},
		loop: Promise.resolve(),
		all: new AbortController(),
	};
	s.live.set(meta.id, l);
	return l;
};
