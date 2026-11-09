import {
	DAEMON_METHODS,
	DaemonDoneResultSchema,
	err,
	type TaskControlAnswer,
	TaskControlAnswerSchema,
	TaskPendingInputSchema,
	TaskPendingResultSchema,
} from "@mete/contracts";
import type { Send } from "./settings-requests.js";
import { verificationRequests } from "./verification-requests.js";

/** Protocol 30's exact task controls; malformed inputs never reach the daemon. */
export const taskControlRequests = (send: Send) => ({
	...verificationRequests(send),
	taskPending: (dir: string, runId: string) => {
		const input = TaskPendingInputSchema.safeParse({ runId });
		if (!input.success)
			return Promise.resolve(
				err({
					code: "protocol" as const,
					detail: input.error.message,
				}),
			);
		return send(dir, DAEMON_METHODS.taskPending, input.data, (raw) =>
			TaskPendingResultSchema.safeParse(raw),
		);
	},
	taskAnswer: (dir: string, answer: TaskControlAnswer) => {
		const input = TaskControlAnswerSchema.safeParse(answer);
		if (!input.success)
			return Promise.resolve(
				err({
					code: "protocol" as const,
					detail: input.error.message,
				}),
			);
		return send(dir, DAEMON_METHODS.taskAnswer, input.data, (raw) =>
			DaemonDoneResultSchema.safeParse(raw),
		);
	},
});
