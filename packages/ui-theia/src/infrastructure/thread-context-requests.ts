import {
	type ContextDraft,
	ContextDraftSchema,
	ContextSnapshotSchema,
	DAEMON_METHODS,
	err,
	ThreadContextReadResultSchema,
	type ThreadContextReplyInput,
	ThreadContextReplyInputSchema,
	type ThreadContextStartInput,
	ThreadContextStartInputSchema,
	type ThreadReadInput,
	ThreadReadInputSchema,
	ThreadStartedSchema,
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
			return Promise.resolve(err({ code: "protocol" as const, detail: "" }));
		return send(dir, method, parsed.data, (raw) =>
			schemas.output.safeParse(raw),
		);
	};

/** Protocol32 context requests never retry through a context-free port (ADR-183). */
export const threadContextRequests = (send: Send) => {
	const prepare = request(send, DAEMON_METHODS.threadContextPrepare, {
		input: ContextDraftSchema,
		output: ContextSnapshotSchema,
	});
	const start = request(send, DAEMON_METHODS.threadContextStart, {
		input: ThreadContextStartInputSchema,
		output: ThreadStartedSchema,
	});
	const reply = request(send, DAEMON_METHODS.threadContextReply, {
		input: ThreadContextReplyInputSchema,
		output: ThreadStartedSchema,
	});
	const read = request(send, DAEMON_METHODS.threadContextRead, {
		input: ThreadReadInputSchema,
		output: ThreadContextReadResultSchema,
	});
	return {
		threadContextPrepare: (dir: string, input: ContextDraft) =>
			prepare(dir, input),
		threadContextStart: (dir: string, input: ThreadContextStartInput) =>
			start(dir, input),
		threadContextReply: (dir: string, input: ThreadContextReplyInput) =>
			reply(dir, input),
		threadContextRead: (dir: string, input: ThreadReadInput) =>
			read(dir, input),
	};
};
