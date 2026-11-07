import {
	DAEMON_METHODS,
	err,
	type ThreadListInput,
	ThreadListInputSchema,
	ThreadListResultSchema,
	type ThreadReadInput,
	ThreadReadInputSchema,
	ThreadReadResultSchema,
	type ThreadReplyInput,
	ThreadReplyInputSchema,
	ThreadStartedSchema,
	type ThreadStartInput,
	ThreadStartInputSchema,
} from "@mete/contracts";
import type { z } from "zod";
import type { Send } from "./settings-requests.js";

const request =
	<I extends object, O>(
		send: Send,
		method: string,
		schemas: { input: z.ZodType<I>; output: z.ZodType<O> },
	) =>
	(dir: string, input: unknown) => {
		const parsed = schemas.input.safeParse(input);
		if (!parsed.success)
			return Promise.resolve(
				err({ code: "protocol" as const, detail: parsed.error.message }),
			);
		return send(dir, method, parsed.data, (raw) =>
			schemas.output.safeParse(raw),
		);
	};

/** Protocol 31 boundaries; uncertain sends never retry through non-idempotent ports. */
export const threadRequests = (send: Send) => {
	const start = request(send, DAEMON_METHODS.threadStart, {
		input: ThreadStartInputSchema,
		output: ThreadStartedSchema,
	});
	const reply = request(send, DAEMON_METHODS.threadReply, {
		input: ThreadReplyInputSchema,
		output: ThreadStartedSchema,
	});
	const list = request(send, DAEMON_METHODS.threadList, {
		input: ThreadListInputSchema,
		output: ThreadListResultSchema,
	});
	const read = request(send, DAEMON_METHODS.threadRead, {
		input: ThreadReadInputSchema,
		output: ThreadReadResultSchema,
	});
	return {
		threadStart: (dir: string, input: ThreadStartInput) => start(dir, input),
		threadReply: (dir: string, input: ThreadReplyInput) => reply(dir, input),
		threadList: (dir: string, input: ThreadListInput) => list(dir, input),
		threadRead: (dir: string, input: ThreadReadInput) => read(dir, input),
	};
};
