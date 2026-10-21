// Public API of this package: types, contracts and the module (CONTRIBUTING.md).

export {
	type GatewayServerOptions,
	serveGateway,
} from "./infrastructure/server.js";
export {
	createGatewayModule,
	type GatewayModule,
	type GatewayOptions,
} from "./module.js";
