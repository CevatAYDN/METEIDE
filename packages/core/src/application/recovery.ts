import type { EngineError, Result } from "@mete/contracts";
import { isAsking } from "../domain/team-run.js";
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
	const context = l.snapshot.context;
	const seated =
		context.task &&
		!context.review &&
		!context.clarify &&
		!context.judge &&
		!isAsking(context) &&
		context.team?.tasks[context.task]?.session?.inFlight === context.inFlight
			? context.task
			: undefined;
	for (const [task, entry] of Object.entries(context.team?.tasks ?? {})) {
		if (!entry.session) continue;
		const { inFlight: callId, ...session } = entry.session;
		if (!callId) continue;
		s.deps.logger.warn(
			{ runId: l.meta.id, taskId: entry.id, callId },
			"a writing tool call was running when the process ended; not run again",
		);
		apply(s, l, {
			type: "WORKER",
			task,
			session,
			requests: 0,
			messages: [
				...entry.messages,
				{
					role: "tool",
					toolCallId: callId,
					content: INTERRUPTED,
				},
			],
		});
	}
	if (seated) apply(s, l, { type: "ACTIVATE", task: seated });
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

// A user pause lets a tool finish, so a crash can leave an uncertain write in a paused row too.
// Quota/network timers are rearmed only after these interrupted calls have been settled.
const rearm = (s: EngineState, find: Find) => {
	for (const id of s.deps.store.paused()) {
		try {
			const l = find(s, id);
			if (!l.ok) continue;
			settleInFlight(s, l.value);
			const pause = l.value.snapshot.context.pause;
			if (
				pause?.resumesAt &&
				(pause.reason === "quota" || pause.reason === "network")
			)
				armTimer(s, l.value, pause.resumesAt);
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
