import { CommandContribution } from "@theia/core";
import { ServiceConnectionProvider } from "@theia/core/lib/browser/messaging/service-connection-provider";
import { ContainerModule } from "@theia/core/shared/inversify";
import { MeteCommandContribution } from "../application/status-command.js";
import {
	METE_DAEMON_PATH,
	MeteDaemonService,
} from "../domain/status-service.js";
import { bindHome } from "./home-contribution.js";

// Theia's generated frontend loads this file by the path in package.json and binds `module.default`.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(MeteDaemonService)
		.toDynamicValue((ctx) =>
			ServiceConnectionProvider.createProxy<MeteDaemonService>(
				ctx.container,
				METE_DAEMON_PATH,
			),
		)
		.inSingletonScope();
	bind(CommandContribution).to(MeteCommandContribution).inSingletonScope();
	bindHome(bind);
});
