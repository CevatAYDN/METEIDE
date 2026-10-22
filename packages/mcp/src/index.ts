// Public API of this package: types, contracts and the module (CONTRIBUTING.md).

export type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
export type { RunHistory } from "./application/mete-tools.js";
export { serveStdio } from "./infrastructure/stdio.js";
export type { Opened, OpenTransport } from "./infrastructure/transport.js";
export {
	createMcpClientModule,
	type McpClientOptions,
} from "./module.js";
export {
	createMcpServerModule,
	type McpServerOptions,
} from "./server-module.js";
