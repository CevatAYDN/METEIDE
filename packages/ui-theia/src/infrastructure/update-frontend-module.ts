import { CommandContribution, MenuContribution } from "@theia/core";
import { ElectronIpcConnectionProvider } from "@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source";
import { ContainerModule } from "@theia/core/shared/inversify";
import { MeteUpdateContribution } from "../application/update-command.js";
import {
	METE_UPDATE_PATH,
	MeteUpdateService,
} from "../domain/update-service.js";

// Theia's generated Electron frontend loads this file by the `frontendElectron` path in
// package.json; the update service lives in the app's main process (ADR-137).
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(MeteUpdateService)
		.toDynamicValue((ctx) =>
			ElectronIpcConnectionProvider.createProxy<MeteUpdateService>(
				ctx.container,
				METE_UPDATE_PATH,
			),
		)
		.inSingletonScope();
	bind(MeteUpdateContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(MeteUpdateContribution);
	bind(MenuContribution).toService(MeteUpdateContribution);
});
