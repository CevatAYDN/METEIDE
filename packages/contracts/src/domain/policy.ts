import { z } from "zod";
import { DEFAULT_POLICY as D } from "../defaults.js";
import { CapabilityRefSchema, IdSchema } from "./ids.js";
import type { Result } from "./result.js";

// policy.check@1 and secrets.mask@1 from docs/06 (Kernel API) and SECURITY.md (Policy file).

/** Action ids the policy talks about (SECURITY.md). */
export const PolicyActionSchema = z.enum([
	"fs.write",
	"fs.delete",
	"fs.write.outside",
	"shell.exec",
	"git.commit",
	"git.push",
	"git.merge",
	"net.fetch",
	"plugin.install",
	"mcp.install",
	"mcp.sampling",
	"runtime.install",
	"release.publish",
	"vault.write.personal",
]);

/** A side-effect action the policy decides on. */
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

const Level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const text = z.string().min(1);

const NeverAllowSchema = z.union([
	z.strictObject({
		action: z.enum(["fs.write", "fs.delete", "fs.write.outside"]),
		path: text,
	}),
	z.strictObject({ action: z.literal("shell.exec"), command: text }),
]);

/** `.mete/policy.yaml` merged over global settings; missing keys take the SECURITY.md example. */
export const PolicySchema = z
	.strictObject({
		autonomy: Level.default(D.autonomy),
		overrides: z
			.record(z.string().pipe(CapabilityRefSchema), Level)
			.default(() => ({})),
		always_ask: z
			.array(PolicyActionSchema)
			.readonly()
			.default(() => [...D.always_ask]),
		never_allow: z
			.array(NeverAllowSchema)
			.readonly()
			.default(() => D.never_allow.map((r) => ({ ...r }))),
		shell: z
			.strictObject({
				allow: z
					.array(text)
					.readonly()
					.default(() => [...D.shellAllow]),
			})
			.prefault({}),
		budget: z
			.strictObject({
				cloud_requests_per_run: z
					.number()
					.int()
					.positive()
					.default(D.cloudRequestsPerRun),
				max_hours: z.number().positive().default(D.maxHours),
			})
			.prefault({}),
		approval_timeout_hours: z
			.number()
			.positive()
			.default(D.approvalTimeoutHours),
	})
	.superRefine((p, ctx) => {
		for (const [ref, level] of Object.entries(p.overrides))
			if (level > p.autonomy)
				ctx.addIssue({
					code: "custom",
					path: ["overrides", ref],
					message: "an override MUST NOT be higher than autonomy",
				});
	})
	.prefault({});

/** A validated policy. */
export type Policy = z.infer<typeof PolicySchema>;

/** Input of policy.check@1; `path` is the real absolute path the adapter will touch. */
export const PolicyCheckInputSchema = z.strictObject({
	action: PolicyActionSchema,
	capability: CapabilityRefSchema,
	adapterId: text,
	args: z.unknown(),
	runId: IdSchema.optional(),
	agentId: IdSchema.optional(),
	path: text.optional(),
	command: text.optional(),
	tainted: z.boolean().optional(),
});

/** What a caller asks policy.check@1. */
export type PolicyCheckInput = z.infer<typeof PolicyCheckInputSchema>;

/** Output of policy.check@1; `rule` names the decision step that fired. */
export const PolicyVerdictSchema = z.strictObject({
	verdict: z.enum(["allow", "ask", "deny"]),
	rule: text,
});

/** The decision for one action. */
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;

/** The audit row could not be written; callers MUST treat it as deny. */
export type AuditFailed = {
	readonly code: "audit_failed";
	readonly message: string;
};

/** The policy.check@1 adapter: decides and writes the audit row in one call. */
export interface PolicyCheckAdapter {
	check(input: PolicyCheckInput): Result<PolicyVerdict, AuditFailed>;
}

/** Output of secrets.mask@1: the text with each secret replaced, and how many were. */
export type MaskResult = { readonly text: string; readonly masked: number };

/** The secrets.mask@1 adapter; replacements look like `[SECRET:<first 8 hex of sha256>]`. */
export interface SecretsMaskAdapter {
	mask(text: string): Promise<MaskResult>;
}
