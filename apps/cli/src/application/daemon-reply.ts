import {
	DAEMON_METHODS,
	type RunReplyAdapter,
	RunReplyInputSchema,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { parsed, readyEngine, refused } from "./daemon-errors.js";

/** Validates the desktop's message and resolves the narrow reply capability (ADR-178). */
export const serveReply = (connection: MessageConnection, app: App) =>
	connection.onRequest(DAEMON_METHODS.runReply, async (params: unknown) => {
		const input = parsed(RunReplyInputSchema.safeParse(params));
		readyEngine(app);
		const adapters = app.registry.resolve<RunReplyAdapter>("run.reply@1");
		if (!adapters.ok || !adapters.value[0])
			throw refused({
				code: "not_supported",
				message: "conversation replies are not available",
			});
		const result = await adapters.value[0].impl.reply(input);
		if (!result.ok) throw refused(result.error);
		return result.value;
	});
