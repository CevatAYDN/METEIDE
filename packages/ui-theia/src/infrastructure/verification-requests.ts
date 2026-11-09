import {
	DAEMON_METHODS,
	err,
	TaskVerificationInputSchema,
	TaskVerificationResultSchema,
} from "@mete/contracts";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { Send } from "./settings-requests.js";

/** Protocol34's read-only evidence; invalid input never starts a daemon. */
export const verificationRequests = (
	send: Send,
): Pick<MeteDaemonService, "verification"> => ({
	verification: (workspaceDir, runId) => {
		const input = TaskVerificationInputSchema.safeParse({ runId });
		if (!input.success)
			return Promise.resolve(
				err({ code: "protocol" as const, detail: input.error.message }),
			);
		return send(
			workspaceDir,
			DAEMON_METHODS.taskVerification,
			input.data,
			(raw) => TaskVerificationResultSchema.safeParse(raw),
		);
	},
});
