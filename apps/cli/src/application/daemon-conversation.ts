import {
	ConversationReplyInputSchema,
	type ConversationRunAdapter,
	ConversationRunOutputSchema,
	ConversationStartInputSchema,
	DAEMON_METHODS,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { serveConversationContext } from "./daemon-context.js";
import { parsed, readyEngine, refused } from "./daemon-errors.js";
import { serveConversationThreads } from "./daemon-threads.js";

const conversationOf = (app: App): ConversationRunAdapter => {
	readyEngine(app);
	const adapters =
		app.registry.resolve<ConversationRunAdapter>("conversation.run@1");
	if (!adapters.ok)
		throw refused({
			code: "not_supported",
			message: "conversation tools are not available",
		});
	return adapters.value[0].impl;
};

/** ADR-180's handlers use the daemon's existing validation, readiness and refusal patterns. */
export const serveConversation = (connection: MessageConnection, app: App) => {
	const threads = serveConversationThreads(connection, app);
	const context = serveConversationContext(connection, app);
	const start = connection.onRequest(
		DAEMON_METHODS.conversationStart,
		async (params: unknown) => {
			const input = parsed(ConversationStartInputSchema.safeParse(params));
			const result = await conversationOf(app).start(input);
			if (!result.ok) throw refused(result.error);
			return ConversationRunOutputSchema.parse(result.value);
		},
	);
	const reply = connection.onRequest(
		DAEMON_METHODS.conversationReply,
		async (params: unknown) => {
			const input = parsed(ConversationReplyInputSchema.safeParse(params));
			const result = await conversationOf(app).reply(input);
			if (!result.ok) throw refused(result.error);
			return ConversationRunOutputSchema.parse(result.value);
		},
	);
	return {
		dispose: () => {
			start.dispose();
			reply.dispose();
			threads.dispose();
			context.dispose();
		},
	};
};
