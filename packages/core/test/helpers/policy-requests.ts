import {
	err,
	ok,
	type PolicyRequest,
	type PolicyRequestsAdapter,
	type ToolContext,
} from "@mete/contracts";

/** Handwritten exact-request adapter for core scheduling tests; no security module import. */
export const policyRequestsFixture = () => {
	const requests = new Map<string, PolicyRequest>();
	const granted = new Set<string>();
	const calls: ToolContext[] = [];
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
			if (agentId) {
				requests.delete(agentId);
				granted.delete(agentId);
			} else {
				requests.clear();
				granted.clear();
			}
			return ok(undefined);
		},
	};
	const run = async (_input: unknown, ctx: ToolContext) => {
		if (!ctx.agentId || !ctx.runId) throw new Error("identity missing");
		calls.push(ctx);
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
	return { port, run, calls };
};
