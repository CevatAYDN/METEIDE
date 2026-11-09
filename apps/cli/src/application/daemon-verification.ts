import {
	DAEMON_METHODS,
	type TaskVerificationAdapter,
	TaskVerificationInputSchema,
	TaskVerificationResultSchema,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { parsed, readyEngine, refused } from "./daemon-errors.js";

/** Protocol34 reads persisted evidence without synthesizing results or starting work. */
export const serveTaskVerification = (
	connection: MessageConnection,
	app: App,
) =>
	connection.onRequest(
		DAEMON_METHODS.taskVerification,
		async (params: unknown) => {
			const input = parsed(TaskVerificationInputSchema.safeParse(params));
			readyEngine(app);
			const adapters = app.registry.resolve<TaskVerificationAdapter>(
				"task.verification@1",
			);
			if (!adapters.ok)
				throw refused({
					code: "not_supported",
					message: "task.verification@1 is not active",
				});
			const result = await adapters.value[0].impl.read(input);
			if (!result.ok) throw refused(result.error);
			return TaskVerificationResultSchema.parse(result.value);
		},
	);
