import {
	err,
	ok,
	type PolicyRequest,
	type PolicyRequestsAdapter,
	type ToolContext,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reply } from "../helpers/engine.js";
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
const twoReaders = (source: string) =>
	source
		.replace("  - { id: c, role: first, title: Task C }\n", "")
		.replace(
			"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
			"",
		)
		.replaceAll("capabilities: []", "capabilities: [web.fetch@1]");
const askPort = () => {
	const requests = new Map<string, PolicyRequest>();
	const granted = new Set<string>();
	const port: PolicyRequestsAdapter = {
		pending: async ({ runId, agentId }) =>
			ok({
				requests: [...requests.values()].filter(
					(r) => r.runId === runId && r.agentId === agentId,
				),
			}),
		grant: ({ runId, agentId, requestId }) => {
			const request = requests.get(agentId);
			if (
				!request ||
				request.runId !== runId ||
				request.requestId !== requestId
			)
				return err({ code: "not_found", message: "stale" });
			requests.delete(agentId);
			granted.add(agentId);
			return ok(undefined);
		},
		forget: ({ agentId }) => {
			if (agentId) requests.delete(agentId);
			else requests.clear();
			return ok(undefined);
		},
	};
	const run = async (_input: unknown, ctx: ToolContext) => {
		if (!ctx.agentId || !ctx.runId) throw new Error("identity missing");
		if (granted.delete(ctx.agentId))
			return ok({
				markdown: "approved page",
				title: "Page",
				finalUrl: "https://example.test/",
			});
		requests.set(ctx.agentId, {
			requestId: crypto.randomUUID(),
			runId: ctx.runId,
			agentId: ctx.agentId,
			ask: {
				action: "net.fetch",
				capability: "web.fetch@1",
				adapterId: "fake-web.fetch@1",
			},
			rule: "fixture",
		});
		return err({ code: "approval_required", message: "ask", rule: "fixture" });
	};
	return { port, run };
};

describe("independent exact policy waits", () => {
	it("keeps both asks, accepts them out of order, and runs only the answered task", async () => {
		const fixture = askPort();
		held = await schedulerHarness({
			scripts: [
				reply("", [
					{ name: "web_fetch", args: { url: "https://example.test/a" } },
				]),
				reply("", [
					{ name: "web_fetch", args: { url: "https://example.test/b" } },
				]),
				reply("done"),
			],
			rewrite: twoReaders,
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
		const pending = await h.tasks.pending({ runId: h.runId });
		if (!pending.ok) throw new Error("pending failed");
		expect(pending.value.requests).toHaveLength(2);
		const a = pending.value.requests.find((r) => r.templateTaskId === "a");
		const b = pending.value.requests.find((r) => r.templateTaskId === "b");
		if (!a || !b) throw new Error("asks missing");
		const answer = (request: typeof a) => ({
			runId: h.runId,
			taskId: request.taskId,
			requestId: request.requestId,
			decision: "allow" as const,
			scope: "once" as const,
		});
		expect((await h.tasks.answer({ ...answer(a), taskId: b.taskId })).ok).toBe(
			false,
		);
		expect((await h.tasks.answer(answer(b))).ok).toBe(true);
		await vi.waitFor(() =>
			expect(stateOf(h)?.context.team?.tasks.b?.status).toBe("approved"),
		);
		expect(
			stateOf(h)?.context.team?.tasks.a?.messages.filter(
				(m) => m.role === "tool",
			),
		).toEqual([]);
		expect((await h.tasks.answer(answer(b))).ok).toBe(false);
		expect((await h.tasks.answer(answer(a))).ok).toBe(true);
		await untilStatus(h, "completed");
		for (const id of ["a", "b"])
			expect(
				stateOf(h)?.context.team?.tasks[id]?.messages.filter(
					(m) => m.role === "tool",
				),
			).toHaveLength(1);
	});
});
