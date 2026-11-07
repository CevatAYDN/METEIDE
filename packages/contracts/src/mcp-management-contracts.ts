/** User-only MCP management contracts; separate from the model tool catalog. */
export {
	type McpConnectionAdapter,
	type McpConnectionRequest,
	McpConnectionRequestSchema,
	type McpConnectionState,
	McpConnectionStateSchema,
	type McpCredentialField,
	McpCredentialFieldSchema,
	type McpCredentialWrite,
	McpCredentialWriteSchema,
	type McpSignInStarted,
	McpSignInStartedSchema,
	type RegistrySetupAdapter,
	type RegistrySetupResult,
	RegistrySetupResultSchema,
} from "./domain/mcp-connection.js";
