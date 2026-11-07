import { createHash } from "node:crypto";
import type {
	ContextSnapshot,
	ThreadReplyInputSchema,
	ThreadStartInputSchema,
} from "@mete/contracts";
import type { z } from "zod";
import type { ThreadIntent } from "../domain/thread.js";

const digest = (payload: object) =>
	createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/** Empty snapshots preserve @1 identity; nonempty snapshots have a separate namespace. */
export const startIntent = (
	data: z.infer<typeof ThreadStartInputSchema>,
	attachments: readonly ContextSnapshot[],
): ThreadIntent => ({
	requestId: data.requestId,
	message: data.goal,
	digest: digest({
		kind: attachments.length ? "context.start@2" : "start",
		goal: data.goal,
		prefer: data.prefer ?? null,
		capabilities: [...data.capabilities].sort(),
		...(attachments.length ? { attachments } : {}),
	}),
});

/** Receipt identity includes the exact ordered full snapshots and all ordinary fields. */
export const replyIntent = (
	data: z.infer<typeof ThreadReplyInputSchema>,
	attachments: readonly ContextSnapshot[],
): ThreadIntent => ({
	requestId: data.requestId,
	conversationId: data.conversationId,
	expectedRunId: data.expectedRunId,
	message: data.message,
	digest: digest({
		kind: attachments.length ? "context.reply@2" : "reply",
		conversationId: data.conversationId,
		expectedRunId: data.expectedRunId,
		message: data.message,
		capabilities:
			data.capabilities === undefined ? null : [...data.capabilities].sort(),
		...(attachments.length ? { attachments } : {}),
	}),
});
