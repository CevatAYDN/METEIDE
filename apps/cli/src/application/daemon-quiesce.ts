import {
	DAEMON_METHODS,
	DaemonQuiesceParamsSchema,
	type RunQuiesceAdapter,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { parsed, refused } from "./daemon-errors.js";

/** The daemon holds the workspace lock; an absent engine cannot be driving work. */
export const admitManagement = async (app: Pick<App, "registry">) => {
	const adapter = app.registry.resolve<RunQuiesceAdapter>("run.quiesce@1");
	if (adapter.ok) {
		const result = await adapter.value[0].impl.prepare();
		if (!result.ok) throw refused(result.error);
		return;
	}
	if (app.registry.has("team.engine@3"))
		throw refused({
			code: "not_supported",
			message: "Safe restart is unavailable",
		});
};

/** The engine closes its start/resume gate atomically, before the host closes stdin. */
export const serveQuiesce = (connection: MessageConnection, app: App) =>
	connection.onRequest(DAEMON_METHODS.quiesce, async (params: unknown) => {
		parsed(DaemonQuiesceParamsSchema.safeParse(params));
		await admitManagement(app);
		return null;
	});
