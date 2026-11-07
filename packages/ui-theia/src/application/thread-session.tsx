import type { ConversationCapability, ThreadReadResult } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type {
	DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";
import type { Shown } from "./board-session.js";
import { type ContextDrafts, contextScope } from "./context-drafts.js";
import type { ContextReceipt as Receipt } from "./context-receipt.js";
import { ConversationTools } from "./conversation-tools.js";
import { createSendIntent } from "./send-intent.js";
import { failureText } from "./status-text.js";

type Selection = readonly ConversationCapability[] | undefined;
type Deps = {
	readonly daemon: () => Pick<MeteDaemonService, "threadReply"> &
		Partial<Pick<MeteDaemonService, "threadContextReply">>;
	readonly drafts?: ContextDrafts | undefined;
	readonly shown: () => Shown | undefined;
	readonly thread: () => ThreadReadResult | undefined;
	readonly show: (dir: string, runId: string, goal: string) => Promise<void>;
	readonly onChange: () => void;
};
const key = (shown: Shown) => JSON.stringify([shown.dir, shown.runId]);

class ThreadSession {
	private readonly selections = new Map<string, Selection>();
	private readonly pending = new Set<string>();
	private readonly localIntents = createSendIntent();
	private readonly localUncertain = new Map<string, Receipt>();
	private get intents() {
		return this.deps.drafts?.intents ?? this.localIntents;
	}
	private get uncertain() {
		return this.deps.drafts?.receipts ?? this.localUncertain;
	}
	constructor(private readonly deps: Deps) {}
	readonly remember = (shown: Shown, selection: Selection) =>
		this.selections.set(key(shown), selection);
	readonly draftChanged = () => {
		const shown = this.deps.shown();
		if (shown) this.retire(key(shown));
	};
	private retire(scope: string) {
		this.intents.clear(scope);
		this.uncertain.delete(scope);
	}
	readonly canRetry = () => {
		const shown = this.deps.shown();
		const receipt = shown ? this.receipt(key(shown)) : undefined;
		return (
			!!shown &&
			!!receipt &&
			!this.pending.has(key(shown)) &&
			!this.deps.drafts?.read(receipt.draftScope).busy
		);
	};
	readonly retry = () => {
		const shown = this.deps.shown();
		const receipt = shown ? this.receipt(key(shown)) : undefined;
		return shown && receipt && !this.pending.has(key(shown))
			? this.dispatch(shown, receipt)
			: Promise.resolve(undefined);
	};
	private receipt(scope: string) {
		const receipt = this.uncertain.get(scope);
		if (
			receipt &&
			this.deps.drafts &&
			this.deps.drafts.read(receipt.draftScope).revision !== receipt.revision
		) {
			this.retire(scope);
			return undefined;
		}
		return receipt;
	}
	private async send(shown: Shown, thread: ThreadReadResult, message: string) {
		const { selections, intents } = this;
		const scope = key(shown);
		const draftScope = contextScope(shown.dir, thread.conversation.id);
		const attachments =
			this.deps.drafts
				?.read(draftScope)
				.attachments.map((item) => item.snapshot) ?? [];
		const capabilities = selections.get(scope);
		const input = {
			conversationId: thread.conversation.id,
			expectedRunId: thread.conversation.head.id,
			message: message.trim(),
			...(attachments.length ? { attachments } : {}),
			...(capabilities === undefined
				? {}
				: { capabilities: [...capabilities] }),
		};
		Object.freeze(attachments);
		if (input.capabilities) Object.freeze(input.capabilities);
		const requestId = intents.for(scope, input);
		return this.dispatch(shown, {
			input: Object.freeze({ ...input, requestId }),
			title: thread.conversation.title,
			selection: capabilities,
			draftScope,
			context: attachments.length > 0,
			revision: this.deps.drafts?.read(draftScope).revision ?? 0,
		});
	}
	private async dispatch(shown: Shown, receipt: Receipt) {
		const { deps, pending } = this;
		const scope = key(shown);
		const frozen = deps.drafts?.lock(receipt.draftScope);
		if (deps.drafts && !frozen)
			return nls.localize("mete/context/busy", "Attachment controls are busy.");
		this.uncertain.set(scope, receipt);
		pending.add(scope);
		deps.onChange();
		try {
			const result = await this.request(shown, receipt);
			if (!result.ok) return this.failed(scope, result.error);
			this.retire(scope);
			if (frozen)
				deps.drafts?.finish(receipt.draftScope, frozen.revision, true);
			this.remember({ ...shown, runId: result.value.runId }, receipt.selection);
			return await this.navigate(shown, receipt, result.value.runId);
		} catch {
			return nls.localize(
				"mete/chat/sendFailed",
				"Could not send. Your message is kept; try again.",
			);
		} finally {
			if (frozen)
				deps.drafts?.finish(receipt.draftScope, frozen.revision, false);
			pending.delete(scope);
			deps.onChange();
		}
	}
	private failed(scope: string, error: DaemonFailure) {
		if (["refused", "not_ready", "choose_template"].includes(error.code))
			this.retire(scope);
		return failureText(error);
	}
	private async navigate(shown: Shown, receipt: Receipt, runId: string) {
		if (this.deps.shown() !== shown) return;
		try {
			await this.deps.show(shown.dir, runId, receipt.title);
		} catch {
			return nls.localize(
				"mete/context/sentViewFailed",
				"The message was sent, but its view could not open. Reopen the conversation.",
			);
		}
	}
	private request(shown: Shown, receipt: Receipt) {
		const daemon = this.deps.daemon();
		if (!receipt.context) return daemon.threadReply(shown.dir, receipt.input);
		return daemon.threadContextReply
			? daemon.threadContextReply(shown.dir, receipt.input)
			: Promise.resolve({
					ok: false as const,
					error: {
						code: "refused" as const,
						detail: nls.localize(
							"mete/context/sendUnavailable",
							"Sending attachments is unavailable. Your draft is kept.",
						),
					},
				});
	}
	readonly reply = async (message: string): Promise<string | undefined> => {
		const { deps, pending } = this;
		const shown = deps.shown();
		const thread = deps.thread();
		if (shown && pending.has(key(shown)))
			return nls.localize(
				"mete/chat/pendingReply",
				"A message is already being sent.",
			);
		const receipt = shown ? this.receipt(key(shown)) : undefined;
		if (shown && receipt?.input.message === message.trim())
			return this.dispatch(shown, receipt);
		if (shown && receipt) this.retire(key(shown));
		return this.admit(shown, thread, message);
	};
	private admit(
		shown: Shown | undefined,
		thread: ThreadReadResult | undefined,
		message: string,
	) {
		if (!shown || !thread)
			return nls.localize(
				"mete/thread/unresolved",
				"Read the conversation before sending. Retry the history read.",
			);
		if (thread.conversation.head.id !== shown.runId)
			return nls.localize(
				"mete/thread/returnLatest",
				"Return to the latest turn to reply.",
			);
		if (thread.conversation.head.status !== "completed")
			return nls.localize(
				"mete/chat/wait",
				"Wait for the current response, or resolve the paused run above.",
			);
		return this.send(shown, thread, message);
	}
	readonly tools = () => {
		const { deps, pending, selections } = this;
		const shown = deps.shown();
		if (!shown) return undefined;
		const scope = key(shown);
		const draftScope = contextScope(
			shown.dir,
			deps.thread()?.conversation.id ?? shown.runId,
		);
		const busy = pending.has(scope) || !!deps.drafts?.read(draftScope).busy;
		return (
			<ConversationTools
				capabilities={selections.get(scope)}
				disabled={busy}
				onChange={(selection) => {
					if (busy) return;
					this.retire(scope);
					selections.set(scope, selection);
					deps.onChange();
				}}
			/>
		);
	};
}

/** New-port sends only; selection identity and exact head guard late responses (ADR-182). */
export const createThreadSession = (deps: Deps) => new ThreadSession(deps);
