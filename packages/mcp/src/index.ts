// Public API of this package: types, contracts and the module (CONTRIBUTING.md).

export type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
export type {
	ElicitRequestFormParams,
	ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
export type { RunHistory } from "./application/mete-tools.js";
export { officialInstall } from "./application/registry-add.js";
export type { RegistryDeps } from "./application/registry-search.js";
export type { Confirm } from "./application/sampling.js";
export type { Elicit } from "./application/sessions.js";
export type { Authorize } from "./application/sign-in.js";
export type { Install } from "./domain/registry-install.js";
export { addMcpServer } from "./infrastructure/mcp-yaml.js";
export { serveStdio } from "./infrastructure/stdio.js";
export type { Opened, OpenTransport } from "./infrastructure/transport.js";
export {
	createMcpClientModule,
	type McpClientOptions,
} from "./module.js";
export {
	createRegistryModule,
	type RegistryOptions,
} from "./registry-module.js";
export {
	createMcpServerModule,
	type McpServerOptions,
} from "./server-module.js";
