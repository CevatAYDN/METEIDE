import type { EventType, LlmError, MeteEvent } from "@mete/contracts";
import type { RunEvent, RunSnapshot } from "./run-machine.js";

// Which run.* event a transition publishes (docs/07, Event catalog) and how a failed model call
// moves the run (docs/08, Single agent). Pure.

/** The type and payload of any catalog event; the envelope is added at publish. */
export type EventBody = {
	[K in EventType]: {
		readonly type: K;
		readonly payload: Extract<MeteEvent, { type: K }>["payload"];
	};
}[EventType];

/** The run.* event for a status change, or undefined when the status stayed. */
export const runEventOf = (
	prev: RunSnapshot,
	next: RunSnapshot,
): EventBody | undefined => {
	if (prev.value === next.value) return undefined;
	const c = next.context;
	switch (next.value) {
		case "running":
			return {
				type: prev.value === "paused" ? "run.resumed" : "run.started",
				payload: {},
			};
		case "paused":
			return {
				type: "run.paused",
				payload: {
					reason: c.pause?.reason ?? "user",
					...(c.pause?.resumesAt ? { resumesAt: c.pause.resumesAt } : {}),
				},
			};
		case "completed":
			return { type: "run.completed", payload: { summary: c.summary ?? "" } };
		case "failed":
			return {
				type: "run.failed",
				payload: c.error ?? { code: "internal", message: "" },
			};
		case "cancelled":
			return { type: "run.cancelled", payload: {} };
		default:
			return undefined;
	}
};

type Moves = Extract<RunEvent, { type: "PAUSE" | "FAIL" }>;

/** What a model error does to the run at `at`: pause for quota, model or network, else fail. */
export const afterModelError = (error: LlmError, at: number): Moves => {
	switch (error.code) {
		case "quota_exhausted":
			return { type: "PAUSE", at, reason: "quota", resumesAt: error.resumesAt };
		case "no_model":
		case "network":
			return { type: "PAUSE", at, reason: error.code };
		default:
			return { type: "FAIL", at, code: error.code, message: error.message };
	}
};
