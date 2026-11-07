import type { ConversationCapability } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { BoardSession } from "./board-session.js";
import { replyToConversation } from "./conversation-reply.js";
import { ConversationTools } from "./conversation-tools.js";

type Selection = readonly ConversationCapability[] | undefined;
type Target = NonNullable<BoardSession["shown"]>;
type Selections = Map<string, Selection>;
type Deps = {
	readonly daemon: () => Pick<MeteDaemonService, "conversationReply">;
	readonly shown: () => BoardSession["shown"];
	readonly show: (dir: string, runId: string, goal: string) => Promise<void>;
	readonly onChange: () => void;
};

const key = (shown: Target) => JSON.stringify([shown.dir, shown.runId]);

const selectedTools = (
	deps: Deps,
	selections: Selections,
	pending: Set<string>,
) => {
	const shown = deps.shown();
	return shown ? (
		<ConversationTools
			capabilities={selections.get(key(shown))}
			disabled={pending.has(key(shown))}
			onChange={(selection) => {
				if (pending.has(key(shown))) return;
				selections.set(key(shown), selection);
				deps.onChange();
			}}
		/>
	) : undefined;
};

/** Per-panel selections follow their workspace/run, never whichever run a late request finds. */
export const createConversationSession = (deps: Deps) => {
	const selections: Selections = new Map();
	const pending = new Set<string>();
	const remember = (shown: Target, selection: Selection) =>
		selections.set(key(shown), selection);
	return {
		remember,
		reply: async (message: string) => {
			const shown = deps.shown();
			if (shown && pending.has(key(shown)))
				return nls.localize(
					"mete/chat/pendingReply",
					"A message is already being sent.",
				);
			if (shown) pending.add(key(shown));
			deps.onChange();
			try {
				return await replyToConversation(
					{
						daemon: deps.daemon(),
						shown,
						current: deps.shown,
						show: deps.show,
						capabilities: shown ? selections.get(key(shown)) : undefined,
						onStarted: (runId, selection) => {
							if (shown) remember({ ...shown, runId }, selection);
						},
					},
					message,
				);
			} finally {
				if (shown) pending.delete(key(shown));
				deps.onChange();
			}
		},
		tools: () => selectedTools(deps, selections, pending),
	};
};
