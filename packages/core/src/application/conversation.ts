import {
	type ConversationCapability,
	ConversationReplyInputSchema,
	type ConversationRunAdapter,
	ConversationStartInputSchema,
	type EngineError,
	err,
	type Result,
	type RunStart,
} from "@mete/contracts";
import { z } from "zod";
import { createReply, type ReplyStart } from "./reply.js";
import type { EngineState } from "./run-state.js";

type Started = Result<{ runId: string }, EngineError>;
type Starts = {
	readonly start: (
		input: RunStart,
		extras: readonly ConversationCapability[],
	) => Promise<Started>;
	readonly reply: (input: ReplyStart) => Started;
};

/** ADR-180's explicit conversation entry uses the same engine and saved-history reply path. */
export const createConversation = (
	state: EngineState,
	starts: Starts,
): ConversationRunAdapter => ({
	async start(input) {
		const parsed = ConversationStartInputSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "bad_input", message: z.prettifyError(parsed.error) });
		const { capabilities, ...req } = parsed.data;
		return starts.start({ ...req, templateId: null }, capabilities);
	},
	async reply(input) {
		const parsed = ConversationReplyInputSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "bad_input", message: z.prettifyError(parsed.error) });
		const { capabilities, ...req } = parsed.data;
		return createReply(state, starts.reply, capabilities).reply(req);
	},
});
