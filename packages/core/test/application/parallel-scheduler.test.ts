import { afterEach, describe, expect, it, vi } from "vitest";
import { reply } from "../helpers/engine.js";
import {
	gatedReply,
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilRequests,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
afterEach(async () => {
	await held?.cleanup();
	held = undefined;
});

describe("live non-writing scheduler", () => {
	it("overlaps two isolated calls, starts a third only after a slot frees, and waits for dependency approval", async () => {
		const gates = ["a", "b", "c", "d"].map(gatedReply);
		const [a, b, c, d] = gates;
		held = await schedulerHarness({
			scripts: gates.map((g) => g.script),
			extra: "policies: { human_checkpoints: [a] }",
		});
		const h = held;
		await untilRequests(h, 2);
		expect(h.requests.map((r) => r.target)).toEqual([
			{ tier: "fast" },
			{ tier: "reasoning" },
		]);
		expect(String(h.requests[0]?.messages[1]?.content)).toContain(
			"Your task: Task A",
		);
		expect(String(h.requests[1]?.messages[1]?.content)).toContain(
			"Your task: Task B",
		);
		expect(stateOf(h)?.context.reservations).toHaveLength(2);
		expect(stateOf(h)?.context.team?.tasks.c?.status).toBe("todo");
		a?.release();
		await untilRequests(h, 3);
		expect(String(h.requests[2]?.messages[1]?.content)).toContain(
			"Your task: Task C",
		);
		expect(stateOf(h)?.context.team?.tasks.b?.messages).not.toContainEqual({
			role: "assistant",
			content: "a",
		});
		c?.release();
		b?.release();
		await untilStatus(h, "paused");
		expect(stateOf(h)?.context.pause?.reason).toBe("approval");
		expect(stateOf(h)?.context.team?.tasks.d?.status).toBe("todo");
		expect(h.requests).toHaveLength(3);
		expect(
			(await h.engine.approve(h.runId, { taskId: "a", decision: "approve" }))
				.ok,
		).toBe(true);
		await untilRequests(h, 4);
		expect(String(h.requests[3]?.messages[1]?.content)).toContain(
			"Report of Task A:\na",
		);
		expect(String(h.requests[3]?.messages[1]?.content)).toContain(
			"Report of Task B:\nb",
		);
		d?.release();
		await untilStatus(h, "completed");
		expect(stateOf(h)?.context.requests).toBe(4);
		const starts = h.events.filter((e) => e.type === "agent.thinking.started");
		expect(new Set(starts.map((e) => e.agentId)).size).toBe(4);
		for (const start of starts) {
			expect(start.taskId).toBeTruthy();
			const ended = h.events.find(
				(e) => e.type === "agent.thinking.ended" && e.agentId === start.agentId,
			);
			expect(ended?.taskId).toBe(start.taskId);
		}
		expect(
			h.db.prepare("SELECT role_id, requests FROM agents ORDER BY rowid").all(),
		).toEqual([
			{ role_id: "first", requests: 1 },
			{ role_id: "second", requests: 1 },
			{ role_id: "first", requests: 1 },
			{ role_id: "second", requests: 1 },
		]);
	});

	it("does not pause or dispatch a second call while the only budget slot is reserved", async () => {
		const a = gatedReply("a");
		held = await schedulerHarness({
			scripts: [a.script, reply("unexpected")],
			policy: { budget: { cloud_requests_per_run: 1 } },
		});
		const h = held;
		await untilRequests(h, 1);
		expect(stateOf(h)?.value).toBe("running");
		expect(stateOf(h)?.context.requests).toBe(0);
		expect(stateOf(h)?.context.reservations).toHaveLength(1);
		a.release();
		await untilStatus(h, "paused");
		expect(h.requests).toHaveLength(1);
		expect(stateOf(h)?.context).toMatchObject({
			requests: 1,
			reservations: [],
			pause: { reason: "budget" },
		});
		expect(stateOf(h)?.context.team?.tasks.a?.status).toBe("approved");
	});

	it("keeps a completed worker reply while another stream is pending", async () => {
		const a = gatedReply("a");
		const b = gatedReply("b");
		const c = gatedReply("c");
		held = await schedulerHarness({
			scripts: [a.script, b.script, c.script, reply("d")],
		});
		const h = held;
		await untilRequests(h, 2);
		b.release();
		await untilRequests(h, 3);
		await vi.waitFor(() =>
			expect(stateOf(h)?.context.team?.tasks.b?.context.report).toBe("b"),
		);
		expect(
			stateOf(h)?.context.team?.tasks.a?.messages.filter(
				(m) => m.role === "assistant",
			),
		).toEqual([]);
		a.release();
		c.release();
		await untilStatus(h, "completed");
		expect(stateOf(h)?.context.team?.tasks.a?.context.report).toBe("a");
		expect(stateOf(h)?.context.team?.tasks.b?.context.report).toBe("b");
	});
});
