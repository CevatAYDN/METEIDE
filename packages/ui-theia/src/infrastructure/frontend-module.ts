import { CommandContribution } from "@theia/core";
import { ContainerModule } from "@theia/core/shared/inversify";
import { MeteCommandContribution } from "../application/status-command.js";

// Theia's generated frontend loads this file by the path in package.json and binds `module.default`.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind) => {
	bind(CommandContribution).to(MeteCommandContribution).inSingletonScope();
});
