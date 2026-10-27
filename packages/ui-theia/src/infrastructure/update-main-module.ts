import { RpcConnectionHandler } from "@theia/core";
import { ElectronConnectionHandler } from "@theia/core/lib/electron-main/messaging/electron-connection-handler";
import { ContainerModule } from "@theia/core/shared/inversify";
import { METE_UPDATE_PATH } from "../domain/update-service.js";
import { MeteUpdateMain } from "./update-main.js";

// Theia's generated Electron main loads this file by the `electronMain` path in package.json.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(MeteUpdateMain).toSelf().inSingletonScope();
	bind(ElectronConnectionHandler)
		.toDynamicValue(
			(ctx) =>
				new RpcConnectionHandler(METE_UPDATE_PATH, () =>
					ctx.container.get(MeteUpdateMain),
				),
		)
		.inSingletonScope();
});
