import type { EngineError, Result } from "@mete/contracts";
import {
	apply,
	armTimer,
	type EngineState,
	iso,
	type Live,
} from "./run-state.js";

// What core-engine does with the runs an earlier process left behind when it activates (docs/07,
// Recovery; ADR-176).

type Find = (s: EngineState, runId: string) => Result<Live, EngineError>;

// A queued run never started, so it starts and pauses at once; START is a no-op for a running one.
const pauseLeftOver = (s: EngineState, l: Live) => {
	const at = s.deps.now();
	apply(s, l, { type: "START", at });
	settleInFlight(s, l);
	apply(s, l, { type: "PAUSE", at, reason: "user" });
};

/** What the model reads in place of the result of a writing call the crash cut (ADR-177). */
export const INTERRUPTED =
	"The process ended while this call ran; whether it wrote is unknown. Read the file or the folder before you write again.";

// A writing call that was running when the process ended may or may not have written (ADR-177): it is
// not run again; the model gets the line above as its result and the human sees the pause.
const settleInFlight = (s: EngineState, l: Live) => {
	const callId = l.snapshot.context.inFlight;
	if (!callId) return;
	s.deps.logger.warn(
		{ runId: l.meta.id, callId },
		"a writing tool call was running when the process ended; not run again",
	);
	apply(s, l, {
		type: "TOOL_DONE",
		message: { role: "tool", toolCallId: callId, content: INTERRUPTED },
	});
};

// A damaged row is marked failed with a warning, so one bad run never keeps the module from activating.
const recoverOne = (s: EngineState, find: Find, id: string) => {
	try {
		const l = find(s, id);
		if (l.ok) pauseLeftOver(s, l.value);
		else if (l.error.code !== "not_found")
			s.deps.logger.warn(
				{ runId: id, reason: l.error.message },
				"run not recovered",
			);
		else {
			s.deps.store.markFailed(id, iso(s.deps.now()));
			s.deps.logger.warn({ runId: id, reason: l.error.message }, "run failed");
		}
	} catch (e) {
		s.deps.logger.warn({ err: e, runId: id }, "run not recovered");
	}
};

// A quota or network pause ends by itself (docs/08): the timer of a run an earlier process paused is
// armed again here, and fires at once when its time has passed (ADR-176).
const rearm = (s: EngineState, find: Find) => {
	for (const id of s.deps.store.selfPaused()) {
		try {
			const l = find(s, id);
			if (!l.ok) continue;
			const resumesAt = l.value.snapshot.context.pause?.resumesAt;
			if (resumesAt) armTimer(s, l.value, resumesAt);
		} catch (e) {
			s.deps.logger.warn({ err: e, runId: id }, "pause timer not armed");
		}
	}
};

/** Pauses, reason user, the runs left queued or running, and arms the timers of self-resuming pauses. */
export const recover = (s: EngineState, find: Find) => {
	for (const id of s.deps.store.unfinished()) recoverOne(s, find, id);
	rearm(s, find);
};
