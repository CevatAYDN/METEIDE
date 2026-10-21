import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import {
	CONTINUE,
	type RunEvent,
	type RunSnapshot,
	runMachine,
} from "../../src/domain/run-machine.js";

const apply = (s: RunSnapshot, ...events: RunEvent[]) =>
	events.reduce((acc, e) => transition(runMachine, acc, e)[0], s);

const fresh = () =>
	initialTransition(runMachine, { goal: "fix it", priority: 1 })[0];

const say = (
	content: string,
	finish: "stop" | "length" = "stop",
): RunEvent => ({
	type: "REPLIED",
	message: { role: "assistant", content },
	finish,
});

describe("run machine", () => {
	it("counts running time only and keeps it across a pause", () => {
		const s = apply(
			fresh(),
			{ type: "START", at: 1_000 },
			{
				type: "PAUSE",
				at: 4_000,
				reason: "quota",
				resumesAt: "2026-10-22T00:00:00.000Z",
			},
			{ type: "RESUME", at: 10_000 },
			{ type: "COMPLETE", at: 12_000, summary: "done" },
		);
		expect(s.value).toBe("completed");
		expect(s.status).toBe("done");
		expect(s.context).toMatchObject({
			activeMs: 5_000,
			startedAt: 1_000,
			endedAt: 12_000,
			summary: "done",
		});
		expect(s.context.pause).toBeUndefined();
	});

	it("asks for more after a reply cut at the token limit", () => {
		const s = apply(fresh(), { type: "START", at: 0 }, say("half", "length"));
		expect(s.context.messages).toEqual([
			{ role: "assistant", content: "half" },
			{ role: "user", content: CONTINUE },
		]);
		expect(s.context.turns).toBe(1);
	});

	it("cancels a failed run but never a completed one", () => {
		const failed = apply(
			fresh(),
			{ type: "START", at: 0 },
			{ type: "FAIL", at: 5, code: "turn_limit", message: "m" },
		);
		expect(failed.can({ type: "CANCEL", at: 6 })).toBe(true);
		const cancelled = apply(failed, { type: "CANCEL", at: 6 });
		expect(cancelled.value).toBe("cancelled");
		expect(cancelled.context.endedAt).toBe(5);
		const done = apply(
			fresh(),
			{ type: "START", at: 0 },
			{ type: "COMPLETE", at: 1, summary: "s" },
		);
		expect(done.can({ type: "CANCEL", at: 2 })).toBe(false);
	});

	it("ends a run cancelled while queued and refuses steps outside running", () => {
		const s = apply(fresh(), { type: "CANCEL", at: 3 });
		expect(s.context.endedAt).toBe(3);
		const paused = apply(
			fresh(),
			{ type: "START", at: 0 },
			{ type: "PAUSE", at: 1, reason: "user" },
		);
		expect(paused.can(say("x"))).toBe(false);
		expect(paused.can({ type: "PAUSE", at: 2, reason: "user" })).toBe(false);
	});

	it("records the agent's model, tool results and checkpointed steps", () => {
		const agent = { id: "a", providerId: "p", modelId: "m" };
		const s = apply(
			fresh(),
			{ type: "MODEL", agent },
			{ type: "START", at: 0 },
			{ type: "CHECKPOINTED", step: 1 },
			{
				type: "TOOL_DONE",
				message: { role: "tool", toolCallId: "c", content: "{}" },
			},
		);
		expect(s.context).toMatchObject({ agent, checkpointed: 1 });
		expect(s.context.messages).toEqual([
			{ role: "tool", toolCallId: "c", content: "{}" },
		]);
	});

	it("restores from its persisted snapshot", () => {
		const s = apply(fresh(), { type: "START", at: 0 }, say("hi"));
		const saved = JSON.parse(
			JSON.stringify(runMachine.getPersistedSnapshot(s)),
		);
		const back = runMachine.resolveState({
			value: saved.value,
			context: saved.context,
		});
		expect(back.value).toBe("running");
		expect(back.context).toEqual(s.context);
	});
});
