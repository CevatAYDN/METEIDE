import {
	type ConversationCapability,
	ModelRefSchema,
	type RunPrefer,
	type ThreadStartInput,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { MeteDaemonService } from "../domain/status-service.js";
import { type ComposerOption, startOf } from "./composer.js";
import { type ContextDrafts, contextScope } from "./context-drafts.js";
import { prepareInitialReceipt } from "./initial-context-receipt.js";
import type { createSendIntent } from "./send-intent.js";

/** A run the initial composer started in its workspace. */
export type StartedRun = {
	readonly dir: string;
	readonly runId: string;
	readonly goal: string;
	readonly capabilities?: readonly ConversationCapability[] | undefined;
};

/** Team selection cannot silently drop or send the single-agent attachment draft. */
export const contextStartFailure = (
	drafts: ContextDrafts | undefined,
	dir: string,
	templateId: string | null | undefined,
) =>
	templateId !== null && drafts?.read(contextScope(dir)).attachments.length
		? nls.localize(
				"mete/context/singleOnly",
				"Attachments are kept for a single-agent message. Remove them or return to Single agent.",
			)
		: undefined;

/** Lock the exact initial draft during admission; failures retain its text and snapshots. */
export const sendInitialDraft = async (deps: {
	readonly drafts: ContextDrafts | undefined;
	readonly dir: string;
	readonly send: () => ReturnType<MeteDaemonService["startRun"]>;
}) => {
	const scope = contextScope(deps.dir);
	const frozen = deps.drafts?.lock(scope);
	if (deps.drafts && !frozen) return undefined;
	try {
		const result = await deps.send();
		if (frozen) deps.drafts?.finish(scope, frozen.revision, result.ok);
		return result;
	} catch {
		if (frozen) deps.drafts?.finish(scope, frozen.revision, false);
		return {
			ok: false as const,
			error: { code: "stopped" as const, detail: "" },
		};
	}
};

/** Ordinary sends retain @1; an ordered attachment payload always requires @2. */
export const startContextMessage = (deps: {
	readonly daemon: Pick<
		MeteDaemonService,
		"threadStart" | "threadContextStart"
	>;
	readonly dir: string;
	readonly input: Omit<ThreadStartInput, "requestId">;
	readonly intents: ReturnType<typeof createSendIntent>;
	readonly drafts?: ContextDrafts | undefined;
}) => {
	const receipt = prepareInitialReceipt({ ...deps, drafts: deps.drafts });
	return receipt.context
		? deps.daemon.threadContextStart(deps.dir, receipt.input)
		: deps.daemon.threadStart(deps.dir, receipt.input);
};

/** Team dispatch stays unchanged; single-agent dispatch owns the complete retained request. */
export const startComposerMessage = (deps: {
	readonly daemon: MeteDaemonService;
	readonly dir: string;
	readonly option: ComposerOption;
	readonly goal: string;
	readonly prefer: RunPrefer | undefined;
	readonly capabilities: readonly ConversationCapability[];
	readonly intents: ReturnType<typeof createSendIntent>;
	readonly drafts: ContextDrafts | undefined;
}) => {
	if (deps.option.templateId !== null)
		return deps.daemon.startRun(
			deps.dir,
			startOf(deps.goal, deps.option, deps.prefer),
		);
	const prefer = ModelRefSchema.safeParse(deps.prefer);
	return startContextMessage({
		...deps,
		input: {
			goal: deps.goal.trim(),
			capabilities: [...deps.capabilities],
			...(prefer.success ? { prefer: prefer.data } : {}),
		},
	});
};
