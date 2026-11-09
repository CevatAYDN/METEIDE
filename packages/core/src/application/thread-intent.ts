import { createHash } from "node:crypto";
import type {
	ContextSnapshot,
	SkillPolicy,
	ThreadReplyInputSchema,
	ThreadStartInputSchema,
} from "@mete/contracts";
import type { z } from "zod";
import type { ThreadIntent } from "../domain/thread.js";

const digest = (payload: object) =>
	createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/** Fixed field order so key order of the caller's object cannot change identity. */
const policyIdentity = (policy: SkillPolicy) => ({
	mode: policy.mode,
	selected: policy.selected.map(({ sourceId, sha256, revision }) => ({
		sourceId,
		sha256,
		revision,
	})),
});

/**
 * Absent `skills` keeps the @1/@2 identity. An @3 intent has its own namespace whose
 * digest covers the full ordered policy; a reply's omission (null) differs from explicit auto.
 */
type SkillsIntent = { readonly skills?: SkillPolicy | null };

const skillsPart = (opts: SkillsIntent | undefined) =>
	opts === undefined || !("skills" in opts)
		? {}
		: { skills: opts.skills ? policyIdentity(opts.skills) : null };
const kindOf = (
	base: "start" | "reply",
	attachments: readonly ContextSnapshot[],
	opts: SkillsIntent | undefined,
) => {
	if (opts !== undefined && "skills" in opts) return `skills.${base}@3`;
	return attachments.length ? `context.${base}@2` : base;
};

/** Empty snapshots preserve @1 identity; nonempty snapshots have a separate namespace. */
export const startIntent = (
	data: z.infer<typeof ThreadStartInputSchema>,
	attachments: readonly ContextSnapshot[],
	opts?: SkillsIntent,
): ThreadIntent => ({
	requestId: data.requestId,
	message: data.goal,
	digest: digest({
		kind: kindOf("start", attachments, opts),
		goal: data.goal,
		prefer: data.prefer ?? null,
		capabilities: [...data.capabilities].sort(),
		...(attachments.length ? { attachments } : {}),
		...skillsPart(opts),
	}),
});

/** Receipt identity includes the exact ordered full snapshots and all ordinary fields. */
export const replyIntent = (
	data: z.infer<typeof ThreadReplyInputSchema>,
	attachments: readonly ContextSnapshot[],
	opts?: SkillsIntent,
): ThreadIntent => ({
	requestId: data.requestId,
	conversationId: data.conversationId,
	expectedRunId: data.expectedRunId,
	message: data.message,
	digest: digest({
		kind: kindOf("reply", attachments, opts),
		conversationId: data.conversationId,
		expectedRunId: data.expectedRunId,
		message: data.message,
		capabilities:
			data.capabilities === undefined ? null : [...data.capabilities].sort(),
		...(attachments.length ? { attachments } : {}),
		...skillsPart(opts),
	}),
});
