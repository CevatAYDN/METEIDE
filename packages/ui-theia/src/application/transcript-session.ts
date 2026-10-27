import type { MeteEvent, Result, Transcript } from "@mete/contracts";
import { THINKING_TICK_MS, TRANSCRIPT_REFETCH_MS } from "../defaults.js";
import type { DaemonFailure } from "../domain/status-service.js";

// The shown run's steps for the Team panel (ADR-125): asked when the run is shown and again, debounced,
// after a step event. An answer for a run no longer shown is dropped; an event during a request asks
// once more when it lands, so the last tool result is never missed. A failure stays beside the last
// steps and the panel says it, so a broken read is never silent. The tick redraws while a model call
// is in flight, for its seconds.

/** What the panel draws: the latest steps, and why the latest read failed. */
export type TranscriptState = {
	readonly transcript?: Transcript;
	readonly failure?: DaemonFailure;
};

type Deps = {
	readonly fetch: (
		dir: string,
		runId: string,
	) => Promise<Result<Transcript, DaemonFailure>>;
	readonly onChange: () => void;
};

type Run = { readonly dir: string; readonly runId: string };

type Box = {
	shown?: Run | undefined;
	state: TranscriptState;
	timer?: ReturnType<typeof setTimeout>;
	ticker?: ReturnType<typeof setInterval> | undefined;
	busy: boolean;
	again: boolean;
};

// A step lands in the conversation when a model call or a tool call ends, or a task or the run moves.
const STEP_EVENTS = (type: string) =>
	type === "agent.thinking.ended" ||
	type === "agent.tool.completed" ||
	type.startsWith("task.") ||
	type.startsWith("run.");

// A transport that rejects (a closed connection) is a failure to show, not an unhandled rejection.
const asked = async (
	deps: Deps,
	run: Run,
): Promise<Result<Transcript, DaemonFailure>> => {
	try {
		return await deps.fetch(run.dir, run.runId);
	} catch (e) {
		return { ok: false, error: { code: "protocol", detail: String(e) } };
	}
};

const load = async (deps: Deps, b: Box): Promise<void> => {
	const run = b.shown;
	if (!run) return;
	if (b.busy) {
		b.again = true;
		return;
	}
	b.busy = true;
	const r = await asked(deps, run);
	b.busy = false;
	if (b.shown === run) {
		b.state = r.ok ? { transcript: r.value } : { ...b.state, failure: r.error };
		deps.onChange();
	}
	if (!b.again) return;
	b.again = false;
	await load(deps, b);
};

const tick = (deps: Deps, b: Box, active: boolean) => {
	if (active && !b.ticker)
		b.ticker = setInterval(deps.onChange, THINKING_TICK_MS);
	if (active || !b.ticker) return;
	clearInterval(b.ticker);
	b.ticker = undefined;
};

/** The transcript of the run the panel shows. */
export const createTranscriptSession = (deps: Deps) => {
	const b: Box = { state: {}, busy: false, again: false };
	return {
		get state(): TranscriptState {
			return b.state;
		},
		/** Shows a run: its steps are asked at once. */
		show(dir: string, runId: string) {
			clearTimeout(b.timer);
			b.shown = { dir, runId };
			b.state = {};
			void load(deps, b);
		},
		/** Asks again, debounced, after a step event of the shown run. */
		onEvent(e: MeteEvent) {
			if (!b.shown || e.runId !== b.shown.runId || !STEP_EVENTS(e.type)) return;
			clearTimeout(b.timer);
			b.timer = setTimeout(() => void load(deps, b), TRANSCRIPT_REFETCH_MS);
		},
		/** Redraws each second while a model call is in flight and the panel is shown. */
		tick: (active: boolean) => tick(deps, b, active),
		dispose() {
			b.shown = undefined;
			clearTimeout(b.timer);
			tick(deps, b, false);
		},
	};
};

/** The session the Team panel keeps. */
export type TranscriptSession = ReturnType<typeof createTranscriptSession>;
