import { describe, expect, it } from "vitest";
import { MAX_TURNS } from "../../src/defaults.js";
import { nextStep } from "../../src/domain/next-step.js";
import type { RunContext } from "../../src/domain/run-machine.js";

const budget = { cloudRequests: 150, maxHours: 6 };
const HOUR = 3_600_000;
const base: RunContext = {
	goal: "g",
	priority: 1,
	messages: [{ role: "user", content: "g" }],
	turns: 0,
	requests: 0,
	activeMs: 0,
	since: 0,
	checkpointed: -1,
};
const withCalls = (...names: string[]): RunContext => ({
	...base,
	turns: 1,
	messages: [
		...base.messages,
		{
			role: "assistant",
			content: "",
			toolCalls: names.map((name, i) => ({
				id: `c${i}`,
				name,
				args:
					name === "vcs_git" ? { op: "commit", message: "m" } : { path: "a" },
			})),
		},
	],
});
const answer = (c: RunContext, id: string): RunContext => ({
	...c,
	messages: [...c.messages, { role: "tool", toolCallId: id, content: "{}" }],
});

describe("nextStep", () => {
	it("asks the model first and completes on a reply without tool calls", () => {
		expect(nextStep(base, budget, 0)).toEqual({ kind: "model" });
		const done: RunContext = {
			...base,
			messages: [...base.messages, { role: "assistant", content: "all done" }],
		};
		expect(nextStep(done, budget, 0)).toEqual({
			kind: "complete",
			summary: "all done",
		});
	});

	it("runs pending tool calls in order and checkpoints a writing step once", () => {
		const c = withCalls("fs_read", "fs_write", "vcs_git");
		expect(nextStep(c, budget, 0)).toMatchObject({
			kind: "tool",
			call: { id: "c0" },
			step: 1,
			checkpoint: false,
		});
		const read = answer(c, "c0");
		expect(nextStep(read, budget, 0)).toMatchObject({
			call: { id: "c1" },
			checkpoint: true,
		});
		expect(nextStep({ ...read, checkpointed: 1 }, budget, 0)).toMatchObject({
			checkpoint: false,
		});
		expect(nextStep(answer(read, "c1"), budget, 0)).toMatchObject({
			call: { id: "c2", name: "vcs_git" },
			checkpoint: true,
		});
	});

	it("asks the model again once every tool call has its result", () => {
		expect(nextStep(answer(withCalls("fs_read"), "c0"), budget, 0)).toEqual({
			kind: "model",
		});
	});

	it("fails at the turn limit and pauses at the budget", () => {
		expect(nextStep({ ...base, turns: MAX_TURNS }, budget, 0)).toMatchObject({
			kind: "fail",
			code: "turn_limit",
		});
		const pause = { kind: "pause", reason: "budget" };
		const twoCalls = { cloudRequests: 2, maxHours: 6 };
		expect(nextStep({ ...base, requests: 2 }, twoCalls, 0)).toEqual(pause);
		// turns count one attempt, requests the whole run (docs/08)
		expect(nextStep({ ...base, turns: 2 }, twoCalls, 0)).toEqual({
			kind: "model",
		});
		const oneHour = { cloudRequests: 150, maxHours: 1 };
		expect(nextStep({ ...base, activeMs: HOUR }, oneHour, 0)).toEqual(pause);
		expect(nextStep(base, oneHour, HOUR)).toEqual(pause);
		expect(nextStep(base, oneHour, HOUR - 1)).toEqual({ kind: "model" });
	});
});
