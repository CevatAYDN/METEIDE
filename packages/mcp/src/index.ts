// Public API of this package: types, contracts and the module (CONTRIBUTING.md).

export type { Opened, OpenTransport } from "./infrastructure/transport.js";
export {
	createMcpClientModule,
	type McpClientOptions,
} from "./module.js";
