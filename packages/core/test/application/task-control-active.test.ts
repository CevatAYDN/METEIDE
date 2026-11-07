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
const releases: (() => void)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	await held?.cleanup();
	held = undefined;
});
const two = (source: string) =>
	source
		.replace("  - { id: c, role: first, title: Task C }\n", "")
		.replace(
			"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
			"",
		);

describe("human control while a peer works", () => {
	it("answers a waiting task without waiting for or replacing its peer model call", async () => {
		const peer = gatedReply("B done");
		releases.push(peer.release);
		held = await schedulerHarness({
			scripts: [reply("A done"), peer.script],
			rewrite: (source) =>
				two(source).replace(
					"title: Task A }",
					"title: Task A, approval: human }",
				),
		});
		const h = held;
		await untilRequests(h, 2);
		await vi.waitFor(() =>
			expect(stateOf(h)?.context.team?.tasks.a?.status).toBe("submitted"),
		);
		const pending = await h.tasks.pending({ runId: h.runId });
		if (!pending.ok || !pending.value.requests[0])
			throw new Error("missing human request");
		const request = pending.value.requests[0];
		expect(stateOf(h)?.value).toBe("running");
		expect(
			(
				await h.tasks.answer({
					runId: h.runId,
					taskId: request.taskId,
					requestId: request.requestId,
					decision: "approve",
				})
			).ok,
		).toBe(true);
		expect(stateOf(h)?.context.team?.tasks.a?.status).toBe("approved");
		expect(stateOf(h)?.context.team?.tasks.b?.status).toBe("in_progress");
		expect(h.requests).toHaveLength(2);
		peer.release();
		await untilStatus(h, "completed");
	});

	it("keeps a human clarification local while an independent task starts", async () => {
		const peer = gatedReply("B done");
		releases.push(peer.release);
		held = await schedulerHarness({
			scripts: [reply("Which target?"), peer.script, reply("A done")],
			rewrite: (source) =>
				two(source).replace(
					"title: Task A }",
					"title: Task A, before_start: { clarify_with: human } }",
				),
		});
		const h = held;
		await untilRequests(h, 2);
		const pending = await h.tasks.pending({ runId: h.runId });
		if (!pending.ok || !pending.value.requests[0])
			throw new Error("missing clarification");
		const request = pending.value.requests[0];
		expect(request).toMatchObject({
			kind: "clarification",
			question: "Which target?",
		});
		expect(stateOf(h)?.value).toBe("running");
		expect(
			(
				await h.tasks.answer({
					runId: h.runId,
					taskId: request.taskId,
					requestId: request.requestId,
					decision: "answer",
					feedback: "Use the local target",
				})
			).ok,
		).toBe(true);
		peer.release();
		await untilStatus(h, "completed");
		expect(
			h.requests
				.at(-1)
				?.messages.some(
					(m) =>
						m.role === "user" &&
						typeof m.content === "string" &&
						m.content.includes("Use the local target"),
				),
		).toBe(true);
	});
});
