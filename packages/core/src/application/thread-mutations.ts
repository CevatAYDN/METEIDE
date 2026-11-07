import {
	type ContextSnapshot,
	type ConversationThreadAdapter,
	type ConversationThreadV2Adapter,
	type EngineError,
	err,
	ok,
	type Result,
	ThreadContextReplyInputSchema,
	ThreadContextStartInputSchema,
	ThreadReplyInputSchema,
	type ThreadStarted,
	ThreadStartInputSchema,
} from "@mete/contracts";
import { z } from "zod";
import type { ThreadIntent, ThreadSaved } from "../domain/thread.js";
import { type Begin, beginThread } from "./begin.js";
import { type ContextAdmission, validateContext } from "./context-snapshot.js";
import { offerBrief } from "./continue.js";
import { retiring } from "./quiesce.js";
import { createReply } from "./reply.js";
import type { EngineState } from "./run-state.js";
import { replyIntent, startIntent } from "./thread-intent.js";

const result = (saved: Result<ThreadStarted, EngineError>) =>
	saved.ok
		? ok({
				conversationId: saved.value.conversationId,
				runId: saved.value.runId,
			})
		: saved;

const start = async (
	s: EngineState,
	data: z.infer<typeof ThreadStartInputSchema>,
	attachments: readonly ContextSnapshot[] = [],
) => {
	const { goal, prefer, capabilities } = data;
	const intent = startIntent(data, attachments);
	const replay = s.deps.store.threads.receipt(intent);
	if (replay) return result(replay);
	let check: ContextAdmission | undefined;
	if (attachments.length) {
		const valid = await validateContext(s, attachments);
		if (!valid.ok) return valid;
		check = valid.value;
	}
	if (s.quiescing) return retiring();
	const input: Begin = {
		id: s.deps.newId(),
		goal,
		priority: 1,
		prefer,
		extraCapabilities: capabilities,
		opening: offerBrief(s),
		attachments,
	};
	const current = check?.();
	if (current && !current.ok) return current;
	return result(await beginThread(s, input, intent));
};

type Admission = {
	readonly intent: ThreadIntent;
	readonly check: ContextAdmission | undefined;
};

const openReply = async (
	s: EngineState,
	data: z.infer<typeof ThreadReplyInputSchema>,
	attachments: readonly ContextSnapshot[],
	admission: Admission,
) => {
	const { conversationId, expectedRunId, message, capabilities } = data;
	const membership = s.deps.store.threads.membership(expectedRunId);
	if ((membership?.conversationId ?? expectedRunId) !== conversationId)
		return err<EngineError>({
			code: "not_found",
			message: "run does not belong to this conversation",
		});
	let pending: Promise<Result<ThreadSaved, EngineError>> | undefined;
	const prepared = await createReply(
		s,
		(input) => {
			// createReply validates and builds history without changing the predecessor.
			const id = s.deps.newId();
			const current = admission.check?.();
			if (current && !current.ok) return current;
			pending = beginThread(
				s,
				{ ...input, id, opening: {}, conversation: input, attachments },
				admission.intent,
			);
			return ok({ runId: id });
		},
		capabilities,
	).reply({ runId: expectedRunId, message });
	if (!prepared.ok) return prepared;
	if (!pending) throw new Error("reply opening was not prepared");
	return result(await pending);
};

const reply = async (
	s: EngineState,
	data: z.infer<typeof ThreadReplyInputSchema>,
	attachments: readonly ContextSnapshot[] = [],
) => {
	const intent = replyIntent(data, attachments);
	const replay = s.deps.store.threads.receipt(intent);
	if (replay) return result(replay);
	let check: ContextAdmission | undefined;
	if (attachments.length) {
		const valid = await validateContext(s, attachments);
		if (!valid.ok) return valid;
		check = valid.value;
		if (
			s.deps.store.list(data.expectedRunId)[0]?.workspaceId !==
			s.deps.workspaceId
		)
			return err<EngineError>({
				code: "not_found",
				message: "Conversation run was not found.",
			});
	}
	if (s.quiescing) return retiring();
	return openReply(s, data, attachments, { intent, check });
};

const createSerial = () => {
	const queues = new Map<string, Promise<unknown>>();
	return async (
		key: string,
		operation: () => Promise<Result<ThreadStarted, EngineError>>,
	) => {
		const prior = queues.get(key);
		const next = (prior ?? Promise.resolve()).then(operation, operation);
		queues.set(key, next);
		try {
			return await next;
		} catch {
			return err<EngineError>({
				code: "failed",
				message: "conversation intent could not be processed",
			});
		} finally {
			if (queues.get(key) === next) queues.delete(key);
		}
	};
};
type Serial = ReturnType<typeof createSerial>;

const contextMutations = (
	s: EngineState,
	serial: Serial,
): Pick<ConversationThreadV2Adapter, "start" | "reply"> => ({
	start: async (input) => {
		const parsed = ThreadContextStartInputSchema.safeParse(input);
		if (!parsed.success)
			return err({
				code: "bad_input",
				message: "Editor context intent is invalid.",
			});
		return serial(parsed.data.requestId, () =>
			start(s, parsed.data, parsed.data.attachments),
		);
	},
	reply: async (input) => {
		const parsed = ThreadContextReplyInputSchema.safeParse(input);
		if (!parsed.success)
			return err({
				code: "bad_input",
				message: "Editor context intent is invalid.",
			});
		return serial(parsed.data.conversationId, () =>
			reply(s, parsed.data, parsed.data.attachments),
		);
	},
});

const legacyMutations = (
	s: EngineState,
	serial: Serial,
): Pick<ConversationThreadAdapter, "start" | "reply"> => ({
	start: async (input) => {
		const parsed = ThreadStartInputSchema.safeParse(input);
		if (!parsed.success)
			return err({
				code: "bad_input",
				message: z.prettifyError(parsed.error),
			});
		return serial(parsed.data.requestId, () => start(s, parsed.data));
	},
	reply: async (input) => {
		const parsed = ThreadReplyInputSchema.safeParse(input);
		if (!parsed.success)
			return err({
				code: "bad_input",
				message: z.prettifyError(parsed.error),
			});
		return serial(parsed.data.conversationId, () => reply(s, parsed.data));
	},
});

/** Both port versions serialize together; SQLite is the cross-instance head/receipt authority. */
export const createThreadMutations = (s: EngineState) => {
	const serial = createSerial();
	return {
		...legacyMutations(s, serial),
		context: contextMutations(s, serial),
	};
};
