import type { ConversationCapability } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { BoardSession } from "./board-session.js";
import { failureText } from "./status-text.js";

type ReplyTarget = {
	readonly daemon: Pick<MeteDaemonService, "conversationReply">;
	readonly shown: BoardSession["shown"];
	readonly current: () => BoardSession["shown"];
	readonly show: (dir: string, runId: string, goal: string) => Promise<void>;
	readonly capabilities: readonly ConversationCapability[] | undefined;
	readonly onStarted: (
		runId: string,
		capabilities: readonly ConversationCapability[] | undefined,
	) => void;
};

/** Capture the shown conversation and selection before awaiting; never navigate a stale result. */
export const replyToConversation = async (
	target: ReplyTarget,
	message: string,
): Promise<string | undefined> => {
	const { shown, daemon, capabilities } = target;
	if (!shown)
		return nls.localize(
			"mete/chat/noConversation",
			"Open a conversation first.",
		);
	const result = await daemon.conversationReply(shown.dir, {
		runId: shown.runId,
		message,
		...(capabilities === undefined ? {} : { capabilities: [...capabilities] }),
	});
	if (!result.ok) return failureText(result.error);
	target.onStarted(result.value.runId, capabilities);
	if (target.current() === shown)
		await target.show(shown.dir, result.value.runId, shown.goal);
};
