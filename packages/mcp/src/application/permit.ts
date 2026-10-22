import {
	type CapabilityRef,
	err,
	ok,
	type PolicyAction,
	type PolicyCheckAdapter,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";

// Every MCP call asks policy.check@1 first: raw calls with mcp.call, mapped calls with the action
// their mapping names (docs/10, Integration levels). Deny and ask come back as errors with the rule.

export type Check = {
	readonly adapterId: string;
	readonly action: PolicyAction;
	readonly capability: CapabilityRef;
	readonly command: string;
	readonly args: unknown;
};

const caller = (ctx: ToolContext) => ({
	...(ctx.runId === undefined ? {} : { runId: ctx.runId }),
	...(ctx.agentId === undefined ? {} : { agentId: ctx.agentId }),
	...(ctx.tainted === undefined ? {} : { tainted: ctx.tainted }),
});

export const permit = (
	policy: PolicyCheckAdapter | undefined,
	check: Check,
	ctx: ToolContext,
): Result<void, ToolError> => {
	if (!policy)
		return err({
			code: "denied",
			rule: "capability_missing",
			message: "policy.check@1 is not provided",
		});
	const v = policy.check({ ...check, ...caller(ctx) });
	if (!v.ok)
		return err({
			code: "denied",
			rule: "audit_failed",
			message: v.error.message,
		});
	const { verdict, rule } = v.value;
	if (verdict === "allow") return ok(undefined);
	return err({
		code: verdict === "ask" ? "approval_required" : "denied",
		rule,
		message: `${check.action} ${check.command}: ${verdict} (${rule})`,
	});
};
