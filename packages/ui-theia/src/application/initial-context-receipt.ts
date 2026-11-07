import type { ThreadStartInput } from "@mete/contracts";
import { type ContextDrafts, contextScope } from "./context-drafts.js";
import type { InitialContextReceipt } from "./context-receipt.js";
import type { createSendIntent } from "./send-intent.js";

/** Busy, focus and failed preparations do not alter this semantic revision. */
export const initialReceipt = (
	drafts: ContextDrafts | undefined,
	dir: string,
) => {
	const scope = contextScope(dir);
	const receipt = drafts?.initialReceipts.get(scope);
	if (receipt?.revision === drafts?.read(scope).revision) return receipt;
	drafts?.initialReceipts.delete(scope);
	return undefined;
};

/** Explicit authored-text or settings edits retire the original admission intent. */
export const retireInitialRequest = (
	drafts: ContextDrafts | undefined,
	intents: ReturnType<typeof createSendIntent>,
	dir: string | undefined,
) => {
	if (!dir) return;
	drafts?.initialReceipts.delete(contextScope(dir));
	intents.clear(dir);
};

/** Restore visible settings to the exact request that Retry will transmit. */
export const initialSettings = (
	drafts: ContextDrafts | undefined,
	dir: string,
) => {
	const input = initialReceipt(drafts, dir)?.input;
	return {
		singleModel: input?.prefer
			? `${input.prefer.providerId}/${input.prefer.modelId}`
			: undefined,
		capabilities: input?.capabilities ?? [],
	};
};

export const initialMessage = (
	drafts: ContextDrafts | undefined,
	dir: string | undefined,
	fallback: string,
) => (dir ? (drafts?.read(contextScope(dir)).message ?? fallback) : fallback);

/** Freeze once before I/O; workspace navigation must never reconstruct an uncertain payload. */
export const prepareInitialReceipt = (deps: {
	readonly dir: string;
	readonly input: Omit<ThreadStartInput, "requestId">;
	readonly intents: ReturnType<typeof createSendIntent>;
	readonly drafts: ContextDrafts | undefined;
}): InitialContextReceipt => {
	const retained = initialReceipt(deps.drafts, deps.dir);
	if (retained) return retained;
	const draft = deps.drafts?.read(contextScope(deps.dir));
	const attachments = draft?.attachments.map((item) => item.snapshot) ?? [];
	Object.freeze(attachments);
	const payload = {
		...deps.input,
		...(deps.input.prefer
			? { prefer: Object.freeze({ ...deps.input.prefer }) }
			: {}),
		...(deps.input.capabilities
			? { capabilities: [...deps.input.capabilities] }
			: {}),
		...(attachments.length ? { attachments } : {}),
	};
	if (payload.capabilities) Object.freeze(payload.capabilities);
	const revision = draft?.revision ?? 0;
	const input = Object.freeze({
		...payload,
		requestId: deps.intents.for(deps.dir, { ...payload, revision }),
	});
	const receipt = Object.freeze({
		input,
		context: attachments.length > 0,
		revision,
	});
	deps.drafts?.initialReceipts.set(contextScope(deps.dir), receipt);
	return receipt;
};
