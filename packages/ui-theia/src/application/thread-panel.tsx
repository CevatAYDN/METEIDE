import { nls } from "@theia/core/lib/common/nls";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { Shown } from "./board-session.js";
import { type ContextDrafts, contextScope } from "./context-drafts.js";
import { Button } from "./runs-list.js";
import { createSentContext } from "./sent-context.js";
import { SentContext } from "./sent-context-view.js";
import {
	createThreadHistory,
	type ThreadHistoryState,
} from "./thread-history.js";
import { ThreadHistory } from "./thread-history-view.js";
import { createThreadSession } from "./thread-session.js";

type Deps = {
	readonly daemon: () => Pick<MeteDaemonService, "threadRead" | "threadReply"> &
		Partial<
			Pick<MeteDaemonService, "threadContextReply" | "threadContextRead">
		>;
	readonly drafts?: (() => ContextDrafts | undefined) | undefined;
	readonly shown: () => Shown | undefined;
	readonly show: (dir: string, runId: string, goal: string) => Promise<void>;
	readonly remove: (runId: string) => void;
	readonly onChange: () => void;
	readonly onHistoryChange?: (state: ThreadHistoryState) => void;
};
type RetryError = { value?: { shown: Shown; message: string } | undefined };
const openRun = (
	deps: Deps,
	shown: Shown | undefined,
	runId: string,
	goal: string,
) => {
	if (shown && deps.shown() === shown) void deps.show(shown.dir, runId, goal);
};
const retryMessage = async (
	deps: Deps,
	conversation: ReturnType<typeof createThreadSession>,
	error: RetryError,
	shown: Shown,
) => {
	if (deps.shown() !== shown) return;
	error.value = undefined;
	deps.onChange();
	const message = await conversation.retry();
	if (deps.shown() !== shown) return;
	error.value = message ? { shown, message } : undefined;
	deps.onChange();
};
type PanelControls = {
	history: ReturnType<typeof createThreadHistory>;
	context: ReturnType<typeof createSentContext>;
	conversation: ReturnType<typeof createThreadSession>;
	error: RetryError;
};
const historyControls = (deps: Deps, model: PanelControls, shown: Shown) => (
	<>
		{model.conversation.canRetry() ? (
			<Button
				label={nls.localize("mete/thread/retryMessage", "Retry message")}
				icon="send"
				onClick={() =>
					retryMessage(deps, model.conversation, model.error, shown)
				}
				quiet
			/>
		) : null}
		{model.error.value?.shown === shown ? (
			<p role="alert">{model.error.value.message}</p>
		) : null}
		<ThreadHistory
			state={model.history.state}
			selected={shown.runId}
			onOpen={(runId, goal) => openRun(deps, shown, runId, goal)}
			onRetry={() => void model.history.refresh()}
			onRemove={(runId) => {
				if (deps.shown() === shown) deps.remove(runId);
			}}
		/>
		<SentContext
			state={model.context.state}
			onRetry={() => void model.context.refresh()}
		/>
	</>
);
const messageDraft = (deps: Deps, model: PanelControls, scope?: string) => {
	const drafts = deps.drafts?.();
	const draft = scope ? drafts?.read(scope) : undefined;
	return draft && scope
		? {
				value: draft.message,
				busy: draft.busy,
				onChange: (message: string) => {
					model.conversation.draftChanged();
					drafts?.message(scope, message);
				},
			}
		: undefined;
};
const controlsFor = (deps: Deps, model: PanelControls) => {
	const shown = deps.shown();
	const conversation =
		model.history.state.phase === "ready"
			? model.history.state.result?.conversation
			: undefined;
	const scope =
		shown && conversation
			? contextScope(shown.dir, conversation.id)
			: undefined;
	return {
		onReply: model.conversation.reply,
		tools: model.conversation.tools(),
		replyReady:
			model.history.state.phase === "ready" &&
			model.history.state.result?.conversation.head.id === shown?.runId,
		onDraftChange: () => {
			model.error.value = undefined;
			model.conversation.draftChanged();
		},
		conversationKey: scope,
		messageDraft: messageDraft(deps, model, scope),
		threadHistory: shown ? historyControls(deps, model, shown) : undefined,
	};
};

/** Panel-local thread authority, history navigation and composer controls (ADR-182). */
export const createThreadPanel = (deps: Deps) => {
	const context = createSentContext({
		fetch: () => deps.daemon().threadContextRead?.bind(deps.daemon()),
		shown: deps.shown,
		onChange: deps.onChange,
	});
	const history = createThreadHistory({
		fetch: (dir, input) => deps.daemon().threadRead(dir, input),
		shown: deps.shown,
		onChange: (state) => {
			deps.onHistoryChange?.(state);
			deps.onChange();
		},
	});
	const conversation = createThreadSession({
		...deps,
		get drafts() {
			return deps.drafts?.();
		},
		thread: () => history.state.result,
	});
	const error: RetryError = {};
	const controls = () =>
		controlsFor(deps, { history, context, conversation, error });
	const clear = () => {
		history.clear();
		context.clear();
	};
	return { history, context, clear, remember: conversation.remember, controls };
};
