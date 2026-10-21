import type { LlmChunk, ToolContext } from "@mete/contracts";
import type { ConfigReader, EventBus, Logger } from "@mete/kernel";
import { transition } from "xstate";
import { type NextStep, nextStep } from "../domain/next-step.js";
import {
	afterModelError,
	type EventBody,
	runEventOf,
} from "../domain/run-events.js";
import {
	type RunEvent,
	type RunSnapshot,
	runMachine,
} from "../domain/run-machine.js";
import type { RunMeta, RunStore } from "../infrastructure/run-store.js";
import {
	callModel,
	callTool,
	createCheckpoint,
	type StepDeps,
} from "./steps.js";

// The loop that moves a running single-agent run step by step (docs/08, Single agent), as
// module-level functions over the engine's state record.

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
};

/** The engine's state: its dependencies, the runs in memory and how a quota timer resumes. */
export type EngineState = {
	readonly deps: EngineDeps;
	readonly live: Map<string, Live>;
	readonly onQuotaReset: (runId: string) => void;
};

// setTimeout fires at once above 2^31 - 1 ms.
const MAX_DELAY_MS = 2_147_483_647;

export const iso = (ms: number) => new Date(ms).toISOString();

export const emit = (s: EngineState, l: Live, body: EventBody) => {
	const agent = l.snapshot.context.agent;
	s.deps.events.publish({
		id: s.deps.newId(),
		ts: iso(s.deps.now()),
		schema: 1,
		workspaceId: s.deps.workspaceId,
		runId: l.meta.id,
		...(agent ? { agentId: agent.id } : {}),
		source: "core-engine",
		...body,
	});
};

export const clearTimer = (l: Live) => {
	l.cancelTimer?.();
	l.cancelTimer = undefined;
};

const armTimer = (s: EngineState, l: Live, resumesAt: string) => {
	const wait = Math.max(0, Date.parse(resumesAt) - s.deps.now());
	l.cancelTimer = s.deps.setTimer(
		() => {
			l.cancelTimer = undefined;
			const c = l.snapshot;
			if (c.value !== "paused" || c.context.pause?.reason !== "quota") return;
			// Another process may have cancelled the run meanwhile (mete stop); the row decides.
			if (s.deps.store.list(l.meta.id)[0]?.status === "paused")
				s.onQuotaReset(l.meta.id);
		},
		Math.min(wait, MAX_DELAY_MS),
	);
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
	if (event.type === "PAUSE" && event.resumesAt)
		armTimer(s, l, event.resumesAt);
	return true;
};

const owns = (l: Live, token: object) =>
	l.token === token && l.snapshot.value === "running";

const toolContext = (l: Live): ToolContext => {
	const agent = l.snapshot.context.agent;
	const ids = agent ? { agentId: agent.id } : {};
	return { runId: l.meta.id, ...ids, signal: l.all.signal };
};

type ModelChunk = Extract<LlmChunk, { type: "model" }>;

// agent.created for the first model, agent.model.changed when a later call uses another one.
const onModel = (s: EngineState, l: Live, c: ModelChunk) => {
	const agent = l.snapshot.context.agent;
	const to = { providerId: c.providerId, modelId: c.modelId };
	if (agent?.providerId === to.providerId && agent.modelId === to.modelId)
		return;
	const next = { id: agent?.id ?? s.deps.newId(), ...to };
	if (!apply(s, l, { type: "MODEL", agent: next })) return; // a done run
	s.deps.store.saveAgent(l.meta.id, next, l.snapshot.context.turns);
	if (!agent)
		return emit(s, l, {
			type: "agent.created",
			payload: { roleId: "assistant", ...to },
		});
	const from = { providerId: agent.providerId, modelId: agent.modelId };
	emit(s, l, {
		type: "agent.model.changed",
		payload: { from, to, reason: c.reason },
	});
};

const modelTurn = async (s: EngineState, l: Live, token: object) => {
	const model = new AbortController();
	l.model = model;
	const signal = AbortSignal.any([l.all.signal, model.signal]);
	const { priority, messages } = l.snapshot.context;
	const run = { runId: l.meta.id, priority, messages };
	emit(s, l, { type: "agent.thinking.started", payload: {} });
	const out = await callModel(
		s.deps,
		run,
		(m) => onModel(s, l, m),
		signal,
	).finally(() => {
		l.model = undefined;
		emit(s, l, { type: "agent.thinking.ended", payload: {} });
	});
	if (!owns(l, token)) return; // paused or cancelled meanwhile: the reply is dropped
	const at = s.deps.now();
	if (out.kind === "missing")
		apply(s, l, { type: "PAUSE", at, reason: "no_model" });
	else if (out.kind === "error") apply(s, l, afterModelError(out.error, at));
	else {
		apply(s, l, { type: "REPLIED", message: out.message, finish: out.finish });
		const { agent, turns } = l.snapshot.context;
		if (agent) s.deps.store.saveAgent(l.meta.id, agent, turns);
	}
};

type ToolStep = Extract<NextStep, { kind: "tool" }>;

// false when the checkpoint failed or the run stopped while it was made.
const checkpoint = async (
	s: EngineState,
	l: Live,
	token: object,
	t: ToolStep,
) => {
	const cp = await createCheckpoint(s.deps, l.meta.id, l.all.signal);
	if (!cp.ok) {
		const at = s.deps.now();
		const fail = { code: "checkpoint_failed", message: cp.error };
		if (owns(l, token)) apply(s, l, { type: "FAIL", at, ...fail });
		return false;
	}
	if (cp.value)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "git", ref: cp.value },
		});
	apply(s, l, { type: "CHECKPOINTED", step: t.step });
	return owns(l, token);
};

// A finished tool call is kept even when the run was paused meanwhile (docs/08).
const toolTurn = async (
	s: EngineState,
	l: Live,
	token: object,
	t: ToolStep,
) => {
	if (t.checkpoint && !(await checkpoint(s, l, token, t))) return;
	const out = await callTool(s.deps, t.call, toolContext(l), (b) =>
		emit(s, l, b),
	);
	if (out.kind === "result")
		apply(s, l, { type: "TOOL_DONE", message: out.message });
	else if (owns(l, token))
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
};

const step = async (s: EngineState, l: Live, token: object) => {
	const at = s.deps.now();
	const next = nextStep(l.snapshot.context, l.meta.budget, at);
	if (next.kind === "model") return modelTurn(s, l, token);
	if (next.kind === "tool") return toolTurn(s, l, token, next);
	if (next.kind === "complete")
		apply(s, l, { type: "COMPLETE", at, summary: next.summary });
	else if (next.kind === "fail")
		apply(s, l, { type: "FAIL", at, code: next.code, message: next.message });
	else apply(s, l, { type: "PAUSE", at, reason: next.reason });
};

const loop = async (s: EngineState, l: Live, token: object) => {
	try {
		while (owns(l, token)) await step(s, l, token);
	} catch (e) {
		// A throwing adapter is a bug; only the error name is kept, as for module.crashed (docs/06).
		s.deps.logger.error({ err: e, runId: l.meta.id }, "run step threw");
		const message = e instanceof Error ? e.name : "Error";
		const fail = { type: "FAIL", code: "internal", message } as const;
		try {
			if (l.token === token) apply(s, l, { ...fail, at: s.deps.now() });
		} catch (again) {
			// The row cannot be written either (a busy database); the run stays as last saved.
			s.deps.logger.error({ err: again, runId: l.meta.id }, "run not failed");
		}
	}
};

/** Starts a drive loop for a running run, after the previous loop stopped. */
export const drive = (s: EngineState, l: Live) => {
	const token = {};
	l.token = token;
	l.all = new AbortController();
	l.loop = l.loop.catch(() => undefined).then(() => loop(s, l, token));
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
