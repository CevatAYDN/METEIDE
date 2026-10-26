import { createHash } from "node:crypto";
import {
	err,
	ok,
	type PolicyCheckAdapter,
	type PolicyCheckInput,
	PolicyCheckInputSchema,
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
	/** Called after the audit row of a check that still asks is written (ADR-121). */
	readonly asked?: (input: PolicyCheckInput, v: PolicyVerdict) => void;
};

// The last decision step (SECURITY.md): a grant of the run turns an ask into allow, never a deny.
const granted = (
	v: PolicyVerdict,
	input: PolicyCheckInput,
	env: CheckerEnv,
	grants: Grants | undefined,
): PolicyVerdict => {
	const scope = v.verdict === "ask" ? grants?.take(input, env) : undefined;
	return scope ? { verdict: "allow", rule: `granted:${scope}` } : v;
};

/** Creates the adapter; an audit write that fails returns `audit_failed`, which callers treat as deny. */
export const createPolicyCheck = (
	/** The environment of each check: the policy in it may change between two calls (ADR-073). */
	env: () => CheckerEnv,
	writeAudit: AuditWriter,
	{ now = Date.now, grants, asked }: CheckHooks = {},
): PolicyCheckAdapter => ({
	check(raw) {
		// Typed in-process callers cannot normally fail this, so a failure is a bug (ADR-034).
		const input = PolicyCheckInputSchema.parse(raw);
		const e = env();
		const v = granted(decide(input, e), input, e, grants);
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
			return err({
				code: "audit_failed",
				message: e instanceof Error ? e.message : String(e),
			});
		}
		if (v.verdict === "ask") asked?.(input, v);
		return ok(v);
	},
});
