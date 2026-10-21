import { createHash } from "node:crypto";
import {
	err,
	ok,
	type PolicyCheckAdapter,
	PolicyCheckInputSchema,
} from "@mete/contracts";
import { type CheckerEnv, decide } from "../domain/checker.js";

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

/** Creates the adapter; an audit write that fails returns `audit_failed`, which callers treat as deny. */
export const createPolicyCheck = (
	env: CheckerEnv,
	writeAudit: AuditWriter,
	now: () => number = Date.now,
): PolicyCheckAdapter => ({
	check(raw) {
		// Typed in-process callers cannot normally fail this, so a failure is a bug (ADR-034).
		const input = PolicyCheckInputSchema.parse(raw);
		const v = decide(input, env);
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
		return ok(v);
	},
});
