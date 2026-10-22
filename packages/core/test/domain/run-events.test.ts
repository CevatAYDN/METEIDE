import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import { afterModelError, runEventOf } from "../../src/domain/run-events.js";
import { type RunEvent, runMachine } from "../../src/domain/run-machine.js";

const fresh = initialTransition(runMachine, {
	goal: "g",
	priority: 1,
	messages: [],
})[0];
const step = (s: typeof fresh, e: RunEvent) => transition(runMachine, s, e)[0];
const running = step(fresh, { type: "START", at: 0 });

describe("run events", () => {
	it("publishes one run event per status change", () => {
		expect(runEventOf(fresh, running)).toEqual({
			type: "run.started",
			payload: {},
		});
		const failed = step(running, {
			type: "FAIL",
			at: 1,
			code: "server",
			message: "m",
		});
		expect(runEventOf(running, failed)).toEqual({
			type: "run.failed",
			payload: { code: "server", message: "m" },
		});
		const cancelled = step(failed, { type: "CANCEL", at: 2 });
		expect(runEventOf(failed, cancelled)).toEqual({
			type: "run.cancelled",
			payload: {},
		});
		const replied = step(running, {
			type: "REPLIED",
			message: { role: "assistant", content: "x" },
			finish: "stop",
		});
		expect(runEventOf(running, replied)).toBeUndefined();
	});

	it("pauses for quota, model and network errors and fails on the rest", () => {
		const at = 5;
		const resumesAt = "2026-10-21T11:00:00.000Z";
		expect(
			afterModelError({ code: "quota_exhausted", message: "q", resumesAt }, at),
		).toEqual({ type: "PAUSE", at, reason: "quota", resumesAt });
		expect(afterModelError({ code: "no_model", message: "m" }, at)).toEqual({
			type: "PAUSE",
			at,
			reason: "no_model",
		});
		// A network pause tries again by itself after NETWORK_RETRY_MS (30 s).
		expect(afterModelError({ code: "network", message: "m" }, at)).toEqual({
			type: "PAUSE",
			at,
			reason: "network",
			resumesAt: new Date(at + 30_000).toISOString(),
		});
		expect(afterModelError({ code: "unauthorized", message: "m" }, at)).toEqual(
			{ type: "FAIL", at, code: "unauthorized", message: "m" },
		);
	});
});
