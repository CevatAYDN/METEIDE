import {
	ElectronMainApplication,
	ElectronMainApplicationContribution,
} from "@theia/core/lib/electron-main/electron-main-application";
import { ContainerModule } from "@theia/core/shared/inversify";
import {
	CspContribution,
	HardenedMainApplication,
} from "./hardened-main-application.js";

// Theia's generated Electron main loads this file by the `electronMain` path in package.json. It
// replaces Theia's main application with the hardened one (ADR-175).
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(HardenedMainApplication).toSelf().inSingletonScope();
	rebind(ElectronMainApplication).toService(HardenedMainApplication);
	bind(CspContribution).toSelf().inSingletonScope();
	bind(ElectronMainApplicationContribution).toService(CspContribution);
});
