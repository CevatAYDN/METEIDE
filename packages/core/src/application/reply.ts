import {
	type ChatMessage,
	type EngineError,
	err,
	type Result,
	type RunPrefer,
	type RunReplyAdapter,
	RunReplyInputSchema,
	type RunReplyOutput,
} from "@mete/contracts";
import { z } from "zod";
import { type EngineState, peek } from "./run-state.js";

export type ReplyStart = {
	readonly goal: string;
	readonly priority: 0 | 1 | 2;
	readonly prefer?: RunPrefer | undefined;
	readonly messages: readonly ChatMessage[];
	readonly tainted: boolean;
};

/** Starts from server-owned saved history; completed run state is never modified. */
export const createReply = (
	state: EngineState,
	start: (input: ReplyStart) => Result<RunReplyOutput, EngineError>,
): RunReplyAdapter => ({
	async reply(input) {
		const parsed = RunReplyInputSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "bad_input", message: z.prettifyError(parsed.error) });
		const source = peek(state, parsed.data.runId);
		if (!source.ok) return source;
		if (source.value.context.team)
			return err({
				code: "not_supported",
				message: "only single-agent conversations accept replies",
			});
		if (source.value.value !== "completed")
			return err({
				code: "invalid_state",
				status: source.value.value,
				message: "finish or resume this run before sending a reply",
			});
		const { priority, prefer, messages, tainted } = source.value.context;
		return start({
			goal: source.value.context.goal,
			priority,
			prefer,
			tainted: tainted === true,
			messages: [...messages, { role: "user", content: parsed.data.message }],
		});
	},
});
