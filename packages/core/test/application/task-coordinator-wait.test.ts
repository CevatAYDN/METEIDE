import { afterEach, describe, expect, it } from "vitest";
import { reply } from "../helpers/engine.js";
import { policyRequestsFixture } from "../helpers/policy-requests.js";
import {
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
afterEach(async () => {
	await held?.cleanup();
	held = undefined;
});
describe("suspended coordinator requests", () => {
	it.each(["review", "clarify"] as const)(
		"preserves the %s agent and conversation while a peer finishes",
		async (kind) => {
			const fixture = policyRequestsFixture();
			const fetch = reply("", [
				{ name: "web_fetch", args: { url: "https://example.test/" } },
			]);
			held = await schedulerHarness({
				scripts:
					kind === "review"
						? [
								reply("A done"),
								reply("B done"),
								fetch,
								reply('{"decision":"approve"}'),
							]
						: [
								reply("Which target?"),
								fetch,
								reply("B done"),
								reply("Use this target"),
								reply("A done"),
							],
				rewrite: (source) =>
					source
						.replace("  - { id: c, role: first, title: Task C }\n", "")
						.replace(
							"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
							"",
						)
						.replace(
							"\ntasks:",
							"\n  - { id: reviewer, name: Reviewer, goal: Review, tier: reasoning, capabilities: [web.fetch@1] }\ntasks:",
						)
						.replace(
							"title: Task A }",
							kind === "review"
								? "title: Task A, approval: reviewer }"
								: "title: Task A, before_start: { clarify_with: reviewer } }",
						),
				tools: [["web.fetch@1", fixture.run]],
				configure: ({ registry }) =>
					registry.provide("policy.requests@1", {
						id: "security",
						trust: "core",
						features: [],
						impl: fixture.port,
					}),
			});
			const h = held;
			await untilStatus(h, "paused");
			expect(stateOf(h)?.context.team?.tasks.b?.status).toBe("approved");
			const pending = await h.tasks.pending({ runId: h.runId });
			if (!pending.ok || !pending.value.requests[0])
				throw new Error("missing policy request");
			const request = pending.value.requests[0];
			const entry = stateOf(h)?.context.team?.tasks.a;
			expect(request.kind).toBe("policy");
			expect(request.agentId).not.toBe(entry?.context.agentId);
			expect(entry?.continuation?.[kind]).toBe("reviewer");
			expect(entry?.continuation?.session.agent?.id).toBe(request.agentId);
			expect(
				(
					await h.tasks.answer({
						runId: h.runId,
						taskId: request.taskId,
						requestId: request.requestId,
						decision: "allow",
						scope: "once",
					})
				).ok,
			).toBe(true);
			await untilStatus(h, "completed");
			expect(fixture.calls.map((call) => call.agentId)).toEqual([
				request.agentId,
				request.agentId,
			]);
			expect(stateOf(h)?.context.team?.tasks.a?.continuation).toBeUndefined();
		},
	);
});
