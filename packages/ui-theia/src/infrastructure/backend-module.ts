import { ConnectionHandler, RpcConnectionHandler } from "@theia/core";
import { BackendApplicationContribution } from "@theia/core/lib/node";
import { ContainerModule } from "@theia/core/shared/inversify";
import {
	METE_DAEMON_PATH,
	MeteDaemonService,
} from "../domain/status-service.js";
import { MeteDaemonBackend } from "./daemon-service.js";

// Theia's generated backend loads this file by the path in package.json and binds `module.default`.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(MeteDaemonBackend).toSelf().inSingletonScope();
	bind(MeteDaemonService).toService(MeteDaemonBackend);
	bind(BackendApplicationContribution).toService(MeteDaemonBackend);
	bind(ConnectionHandler)
		.toDynamicValue(
			(ctx) =>
				new RpcConnectionHandler<MeteDaemonService>(METE_DAEMON_PATH, () =>
					ctx.container.get<MeteDaemonService>(MeteDaemonService),
				),
		)
		.inSingletonScope();
});
