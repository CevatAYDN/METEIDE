import { CommandContribution } from "@theia/core";
import { ServiceConnectionProvider } from "@theia/core/lib/browser/messaging/service-connection-provider";
import { ContainerModule } from "@theia/core/shared/inversify";
import { MeteApprovalContribution } from "../application/approval-commands.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { MeteKeyContribution } from "../application/key-command.js";
import { MeteStartRunContribution } from "../application/start-run-command.js";
import { MeteCommandContribution } from "../application/status-command.js";
import {
	METE_DAEMON_PATH,
	MeteDaemonService,
} from "../domain/status-service.js";
import { bindHome } from "./home-contribution.js";

// Theia's generated frontend loads this file by the path in package.json and binds `module.default`.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(MeteDaemonEvents).toSelf().inSingletonScope();
	// The events object is the client the backend calls back (ADR-047: events reach the panels).
	bind(MeteDaemonService)
		.toDynamicValue((ctx) =>
			ServiceConnectionProvider.createProxy<MeteDaemonService>(
				ctx.container,
				METE_DAEMON_PATH,
				ctx.container.get(MeteDaemonEvents),
			),
		)
		.inSingletonScope();
	bind(CommandContribution).to(MeteCommandContribution).inSingletonScope();
	bind(CommandContribution).to(MeteStartRunContribution).inSingletonScope();
	bind(CommandContribution).to(MeteApprovalContribution).inSingletonScope();
	bind(CommandContribution).to(MeteKeyContribution).inSingletonScope();
	bindHome(bind);
});
