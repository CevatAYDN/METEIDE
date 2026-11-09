import {
	type ContextSnapshot,
	type ConversationThreadAdapter,
	type ConversationThreadV2Adapter,
	type ConversationThreadV3Adapter,
	type EngineError,
	err,
	ok,
	type Result,
	type SkillPolicy,
	ThreadContextReplyInputSchema,
	ThreadContextStartInputSchema,
	ThreadReplyInputSchema,
	ThreadSkillsReplyInputSchema,
	ThreadSkillsStartInputSchema,
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
import { type EngineState, loaded } from "./run-state.js";
import {
	inheritedSkillPolicy,
	initialSkillState,
	preflightSkills,
} from "./skill-admission.js";
import { replyIntent, startIntent } from "./thread-intent.js";

const result = (saved: Result<ThreadStarted, EngineError>) =>
	saved.ok
		? ok({
				conversationId: saved.value.conversationId,
				runId: saved.value.runId,
			})
		: saved;

const startContext = async (
	s: EngineState,
	attachments: readonly ContextSnapshot[],
): Promise<Result<ContextAdmission | undefined, EngineError>> =>
	attachments.length ? validateContext(s, attachments) : ok(undefined);

const startSkills = async (
	s: EngineState,
	skills: SkillPolicy | undefined,
): Promise<Result<void, EngineError>> =>
	skills
		? preflightSkills(s, skills, new AbortController().signal)
		: ok(undefined);

const start = async (
	s: EngineState,
	data: z.infer<typeof ThreadStartInputSchema>,
	attachments: readonly ContextSnapshot[] = [],
	skills?: SkillPolicy,
) => {
	const { goal, prefer, capabilities } = data;
	const intent = startIntent(data, attachments, skills && { skills });
	const replay = s.deps.store.threads.receipt(intent);
	if (replay) return result(replay);
	const check = await startContext(s, attachments);
	if (!check.ok) return check;
	const pre = await startSkills(s, skills);
	if (!pre.ok) return pre;
	if (s.quiescing) return retiring();
	const id = s.deps.newId();
	const input: Begin = {
		id,
		goal,
		priority: 1,
		prefer,
		extraCapabilities: capabilities,
		opening: offerBrief(s),
		attachments,
		skills: skills && initialSkillState(id, skills, s.deps.newId),
	};
	const current = check.value?.();
	if (current && !current.ok) return current;
	return result(await beginThread(s, input, intent));
};

type Admission = {
	readonly intent: ThreadIntent;
	readonly check: ContextAdmission | undefined;
	/** @3 only: the resolved policy for the new run; never the predecessor's loads. */
	readonly skills?: SkillPolicy | undefined;
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
				{
					...input,
					id,
					opening: {},
					conversation: input,
					attachments,
					skills:
						admission.skills &&
						initialSkillState(id, admission.skills, s.deps.newId),
				},
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

/** Omitted reply policy inherits the predecessor's mode only (ADR-190). */
const replyPolicy = (
	s: EngineState,
	runId: string,
	given: SkillPolicy | null,
): SkillPolicy => {
	if (given) return given;
	const prior = loaded(s, runId);
	return inheritedSkillPolicy(
		prior.ok ? prior.value?.snapshot.context.skills : undefined,
	);
};

/** Context admission for a reply also requires the predecessor's workspace. */
const replyContext = async (
	s: EngineState,
	runId: string,
	attachments: readonly ContextSnapshot[],
): Promise<Result<ContextAdmission | undefined, EngineError>> => {
	if (!attachments.length) return ok(undefined);
	const valid = await validateContext(s, attachments);
	if (!valid.ok) return valid;
	if (s.deps.store.list(runId)[0]?.workspaceId !== s.deps.workspaceId)
		return err({
			code: "not_found",
			message: "Conversation run was not found.",
		});
	return valid;
};

const replySkills = async (
	s: EngineState,
	runId: string,
	skills: { readonly given: SkillPolicy | null } | undefined,
): Promise<Result<SkillPolicy | undefined, EngineError>> => {
	if (!skills) return ok(undefined);
	const policy = replyPolicy(s, runId, skills.given);
	const pre = await preflightSkills(s, policy, new AbortController().signal);
	return pre.ok ? ok(policy) : pre;
};

const reply = async (
	s: EngineState,
	data: z.infer<typeof ThreadReplyInputSchema>,
	attachments: readonly ContextSnapshot[] = [],
	skills?: { readonly given: SkillPolicy | null },
) => {
	const intent = replyIntent(
		data,
		attachments,
		skills && { skills: skills.given },
	);
	const replay = s.deps.store.threads.receipt(intent);
	if (replay) return result(replay);
	const check = await replyContext(s, data.expectedRunId, attachments);
	if (!check.ok) return check;
	const policy = await replySkills(s, data.expectedRunId, skills);
	if (!policy.ok) return policy;
	if (s.quiescing) return retiring();
	return openReply(s, data, attachments, {
		intent,
		check: check.value,
		skills: policy.value,
	});
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

const skillMutations = (
	s: EngineState,
	serial: Serial,
): Pick<ConversationThreadV3Adapter, "start" | "reply"> => ({
	start: async (input) => {
		const parsed = ThreadSkillsStartInputSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "bad_input", message: "Skill intent is invalid." });
		const { skills, ...data } = parsed.data;
		return serial(data.requestId, () =>
			start(s, data, data.attachments, skills),
		);
	},
	reply: async (input) => {
		const parsed = ThreadSkillsReplyInputSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "bad_input", message: "Skill intent is invalid." });
		const { skills, ...data } = parsed.data;
		return serial(data.conversationId, () =>
			reply(s, data, data.attachments, { given: skills ?? null }),
		);
	},
});

/** Both port versions serialize together; SQLite is the cross-instance head/receipt authority. */
export const createThreadMutations = (s: EngineState) => {
	const serial = createSerial();
	return {
		...legacyMutations(s, serial),
		context: contextMutations(s, serial),
		skills: skillMutations(s, serial),
	};
};
