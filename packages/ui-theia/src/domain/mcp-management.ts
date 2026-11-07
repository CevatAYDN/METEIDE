import type {
	McpConnectionRequest,
	McpCredentialWrite,
	McpSignInStarted,
	RegistrySetupResult,
	Result,
} from "@mete/contracts";
import type { DaemonFailure } from "./daemon-failure.js";

/** Explicit settings operations; credentials have no read method. */
export interface McpManagementService {
	mcpConnection(
		dir: string,
		input: McpConnectionRequest,
	): Promise<Result<McpSignInStarted, DaemonFailure>>;
	setMcpCredentials(
		dir: string,
		input: McpCredentialWrite,
	): Promise<Result<null, DaemonFailure>>;
	registrySetup(
		dir: string,
		name: string,
	): Promise<Result<RegistrySetupResult, DaemonFailure>>;
}
