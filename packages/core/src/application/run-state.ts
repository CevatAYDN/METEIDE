import type { ConfigReader, EventBus, Logger } from "@mete/kernel";
import { transition } from "xstate";
import { type EventBody, runEventOf } from "../domain/run-events.js";
import {
	type RunEvent,
	type RunSnapshot,
	runMachine,
} from "../domain/run-machine.js";
import type { RunMeta, RunStore } from "../infrastructure/run-store.js";
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
