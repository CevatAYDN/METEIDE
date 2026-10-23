import { ConnectionHandler, RpcConnectionHandler } from "@theia/core";
import { BackendApplicationContribution } from "@theia/core/lib/node";
import { LocalizationContribution } from "@theia/core/lib/node/i18n/localization-contribution";
import { ContainerModule } from "@theia/core/shared/inversify";
import {
	METE_DAEMON_PATH,
	type MeteDaemonClient,
	MeteDaemonService,
} from "../domain/status-service.js";
import { MeteDaemonBackend } from "./daemon-service.js";
import { MeteLocalizationContribution } from "./localization.js";

// Theia's generated backend loads this file by the path in package.json and binds `module.default`.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(MeteDaemonBackend).toSelf().inSingletonScope();
	bind(MeteDaemonService).toService(MeteDaemonBackend);
	bind(BackendApplicationContribution).toService(MeteDaemonBackend);
	bind(LocalizationContribution)
		.to(MeteLocalizationContribution)
		.inSingletonScope();
	bind(ConnectionHandler)
		.toDynamicValue(
			(ctx) =>
				// Each frontend connection brings its client; it receives events until it closes.
				new RpcConnectionHandler<MeteDaemonClient>(
					METE_DAEMON_PATH,
					(client) => {
						const backend = ctx.container.get(MeteDaemonBackend);
						backend.addClient(client);
						client.onDidCloseConnection(() => backend.removeClient(client));
						return backend;
					},
				),
		)
		.inSingletonScope();
});
