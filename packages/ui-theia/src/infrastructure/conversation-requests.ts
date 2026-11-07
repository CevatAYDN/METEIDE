import {
	type ConversationReplyInput,
	ConversationReplyInputSchema,
	ConversationRunOutputSchema,
	type ConversationStartInput,
	ConversationStartInputSchema,
	DAEMON_METHODS,
	err,
} from "@mete/contracts";
import type { Send } from "./settings-requests.js";
import { threadRequests } from "./thread-requests.js";

/** Protocol 29's typed requests; invalid selections never reach a daemon. */
export const conversationRequests = (send: Send) => ({
	...threadRequests(send),
	conversationStart: (dir: string, input: ConversationStartInput) => {
		const parsed = ConversationStartInputSchema.safeParse(input);
		if (!parsed.success)
			return Promise.resolve(
				err({
					code: "protocol" as const,
					detail: parsed.error.message,
				}),
			);
		return send(dir, DAEMON_METHODS.conversationStart, parsed.data, (raw) =>
			ConversationRunOutputSchema.safeParse(raw),
		);
	},
	conversationReply: (dir: string, input: ConversationReplyInput) => {
		const parsed = ConversationReplyInputSchema.safeParse(input);
		if (!parsed.success)
			return Promise.resolve(
				err({
					code: "protocol" as const,
					detail: parsed.error.message,
				}),
			);
		return send(dir, DAEMON_METHODS.conversationReply, parsed.data, (raw) =>
			ConversationRunOutputSchema.safeParse(raw),
		);
	},
});
