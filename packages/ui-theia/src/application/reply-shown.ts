import type { MeteDaemonService } from "../domain/status-service.js";
import type { BoardSession } from "./board-session.js";
import { failureText } from "./status-text.js";

/** A reply result may arrive after navigation; never replace the newly selected conversation. */
export const replyShown = async (
	{
		daemon,
		shown,
		current,
		show,
	}: {
		readonly daemon: Pick<MeteDaemonService, "replyRun">;
		readonly shown: BoardSession["shown"];
		readonly current: () => BoardSession["shown"];
		readonly show: (dir: string, runId: string, goal: string) => Promise<void>;
	},
	message: string,
): Promise<string | undefined> => {
	if (!shown) return "Open a conversation first.";
	const result = await daemon.replyRun(shown.dir, {
		runId: shown.runId,
		message,
	});
	if (!result.ok) return failureText(result.error);
	if (current() === shown)
		await show(shown.dir, result.value.runId, shown.goal);
};
