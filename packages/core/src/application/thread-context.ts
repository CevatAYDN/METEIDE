import {
	ContextAttachmentsSchema,
	type ConversationThreadAdapter,
	type ConversationThreadV2Adapter,
	type EngineError,
	err,
	ok,
	type Result,
	type SecretsMaskAdapter,
	type ThreadContextReadResult,
	ThreadContextReadResultSchema,
	ThreadReadInputSchema,
} from "@mete/contracts";
import {
	contextHash,
	maskContext,
	prepareContext,
} from "./context-snapshot.js";
import type { EngineState } from "./run-state.js";

const missing = () =>
	err<EngineError>({
		code: "not_found",
		message: "Editor context run was not found.",
	});

const read = async (
	s: EngineState,
	runId: string,
): Promise<Result<ThreadContextReadResult, EngineError>> => {
	const row = s.deps.store.load(runId);
	if (!row || row.meta.workspaceId !== s.deps.workspaceId) return missing();
	const masker = s.deps.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	if (!masker.ok)
		return err({
			code: "not_supported",
			message: "Editor context masking is unavailable.",
		});
	const snapshots = ContextAttachmentsSchema.parse(
		row.snapshot.context.attachments ?? [],
	);
	if (snapshots.some((snapshot) => contextHash(snapshot) !== snapshot.sha256))
		return err({
			code: "failed",
			message: "Editor context history is invalid.",
		});
	const attachments = await maskContext(masker.value[0].impl, snapshots);
	const current = s.deps.store.list(runId)[0];
	if (!current || current.workspaceId !== s.deps.workspaceId) return missing();
	const currentMask =
		s.deps.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	if (!currentMask.ok || currentMask.value[0].impl !== masker.value[0].impl)
		return err({
			code: "failed",
			message: "Editor context masking changed during read.",
		});
	return ok(ThreadContextReadResultSchema.parse({ runId, attachments }));
};

/** Immutable sent snapshots share the thread's existing list/read and admission authority. */
export const createThreadContext = (
	s: EngineState,
	mutations: Pick<ConversationThreadV2Adapter, "start" | "reply">,
	reads: Pick<ConversationThreadAdapter, "list" | "read">,
): ConversationThreadV2Adapter => ({
	...reads,
	...mutations,
	prepare: (input) => prepareContext(s, input),
	context: async (input) => {
		const parsed = ThreadReadInputSchema.safeParse(input);
		if (!parsed.success)
			return err({
				code: "bad_input",
				message: "Editor context request is invalid.",
			});
		try {
			return await read(s, parsed.data.runId);
		} catch {
			return err({
				code: "failed",
				message: "Editor context history could not be read.",
			});
		}
	},
});
