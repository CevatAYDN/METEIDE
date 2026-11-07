import {
	DAEMON_METHODS,
	type TaskControlAdapter,
	TaskControlAnswerSchema,
	TaskPendingInputSchema,
	TaskPendingResultSchema,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { z } from "zod";
import type { App } from "../infrastructure/app.js";
import { parsed, refused } from "./daemon-errors.js";

const controlOf = (app: App): TaskControlAdapter => {
	const adapters = app.registry.resolve<TaskControlAdapter>("task.control@1");
	if (!adapters.ok)
		throw refused({
			code: "not_supported",
			message: "task.control@1 is not active",
		});
	return adapters.value[0].impl;
};

/** Serves exact task decisions through the authoritative port, including pending reads before readiness. */
export const serveTaskControl = (connection: MessageConnection, app: App) => {
	const pending = connection.onRequest(
		DAEMON_METHODS.taskPending,
		async (params: unknown) => {
			const input = parsed(TaskPendingInputSchema.safeParse(params));
			const result = await controlOf(app).pending(input);
			if (!result.ok) throw refused(result.error);
			return TaskPendingResultSchema.parse(result.value);
		},
	);
	const answer = connection.onRequest(
		DAEMON_METHODS.taskAnswer,
		async (params: unknown) => {
			const input = parsed(TaskControlAnswerSchema.safeParse(params));
			const result = await controlOf(app).answer(input);
			if (!result.ok) throw refused(result.error);
			z.undefined().parse(result.value);
			return null;
		},
	);
	return {
		dispose: () => {
			pending.dispose();
			answer.dispose();
		},
	};
};
