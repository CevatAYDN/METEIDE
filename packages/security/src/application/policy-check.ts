import { createHash } from "node:crypto";
import {
	err,
	ok,
	type PolicyCheckAdapter,
	type PolicyCheckInput,
	PolicyCheckInputSchema,
	type PolicyForgetInput,
	type PolicyVerdict,
} from "@mete/contracts";
import { type CheckerEnv, decide } from "../domain/checker.js";
import type { Grants } from "./grants.js";

// policy.check@1 from SECURITY.md: decide, then write the audit row in the same call.

/** Writes one audit row; throws when the database refuses it. */
export type AuditWriter = (row: {
	readonly ts: string;
	readonly runId: string | null;
	readonly agentId: string | null;
	readonly action: string;
	readonly capability: string;
	readonly adapterId: string;
	readonly argsSha256: string;
	readonly verdict: string;
	readonly rule: string;
	readonly tainted: boolean;
}) => void;

// Arguments that JSON cannot represent (cycles, BigInt) still get a stable hash.
const hashArgs = (args: unknown) => {
	let text: string;
	try {
		text = JSON.stringify(args) ?? "null";
	} catch {
		text = "[unserializable]";
	}
	return createHash("sha256").update(text).digest("hex");
};

/** What a check does besides deciding: the clock, the human's grants and who hears of an ask. */
export type CheckHooks = {
	readonly now?: () => number;
	readonly grants?: Grants;
	/** Exact process-local task requests (ADR-181); remember is synchronous and audit-gated. */
	readonly requests?: {
		take(input: PolicyCheckInput): "once" | "task" | undefined;
		remember(input: PolicyCheckInput, verdict: PolicyVerdict): void;
		forget(input: PolicyForgetInput): void;
	};
	/** Called after the audit row of a check that still asks is written (ADR-121). */
	readonly asked?: (input: PolicyCheckInput, v: PolicyVerdict) => void;
};

const forgetAfterAuditFailure = (
	input: PolicyCheckInput,
	requests: CheckHooks["requests"],
) => {
	if (input.runId && input.agentId)
		requests?.forget({ runId: input.runId, agentId: input.agentId });
};

// The last decision step (SECURITY.md): a grant of the run turns an ask into allow, never a deny.
// The first matching check uses a once grant up whatever it decides, so a once grant that
// shell.always made needless cannot let a later tainted call through.
const granted = (
	v: PolicyVerdict,
	input: PolicyCheckInput,
	env: CheckerEnv,
	hooks: CheckHooks,
): PolicyVerdict => {
	const scope = hooks.requests?.take(input) ?? hooks.grants?.take(input, env);
	return scope && v.verdict === "ask"
		? { verdict: "allow", rule: `granted:${scope}` }
		: v;
};

/** Creates the adapter; an audit write that fails returns `audit_failed`, which callers treat as deny. */
export const createPolicyCheck = (
	/** The environment of each check: the policy in it may change between two calls (ADR-073). */
	env: () => CheckerEnv,
	writeAudit: AuditWriter,
	{ now = Date.now, ...hooks }: CheckHooks = {},
): PolicyCheckAdapter => ({
	check(raw) {
		// Typed in-process callers cannot normally fail this, so a failure is a bug (ADR-034).
		const input = PolicyCheckInputSchema.parse(raw);
		const e = env();
		const v = granted(decide(input, e), input, e, hooks);
		try {
			writeAudit({
				ts: new Date(now()).toISOString(),
				runId: input.runId ?? null,
				agentId: input.agentId ?? null,
				action: input.action,
				capability: input.capability,
				adapterId: input.adapterId,
				argsSha256: hashArgs(input.args),
				verdict: v.verdict,
				rule: v.rule,
				tainted: input.tainted ?? false,
			});
		} catch (e) {
			forgetAfterAuditFailure(input, hooks.requests);
			return err({
				code: "audit_failed",
				message: e instanceof Error ? e.message : String(e),
			});
		}
		if (v.verdict === "ask") {
			hooks.requests?.remember(input, v);
			hooks.asked?.(input, v);
		}
		return ok(v);
	},
});
