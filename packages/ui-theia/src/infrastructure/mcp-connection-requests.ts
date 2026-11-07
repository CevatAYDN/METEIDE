import {
	DAEMON_METHODS,
	err,
	type McpConnectionRequest,
	McpSignInStartedSchema,
	RegistrySetupResultSchema,
} from "@mete/contracts";
import type { Send } from "./settings-requests.js";

/** Protocol33 management responses are strict and never downgraded to legacy operations. */
export const mcpConnectionRequests = (
	send: Send,
	mayCancel: (dir: string) => boolean = () => true,
) => ({
	mcpConnection: (dir: string, input: McpConnectionRequest) =>
		input.op === "cancel" && !mayCancel(dir)
			? Promise.resolve(
					err({
						code: "stopped" as const,
						detail: "The sign-in daemon has already stopped",
					}),
				)
			: send(dir, DAEMON_METHODS.mcpConnection, input, (raw) =>
					McpSignInStartedSchema.safeParse(raw),
				),
	registrySetup: (dir: string, name: string) =>
		send(dir, DAEMON_METHODS.registrySetup, { name }, (raw) =>
			RegistrySetupResultSchema.safeParse(raw),
		),
});
