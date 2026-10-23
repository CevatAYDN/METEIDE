import { CommandContribution } from "@theia/core";
import { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { KeybindingContribution } from "@theia/core/lib/browser/keybinding";
import type { interfaces } from "@theia/core/shared/inversify";
import {
	MeteStopAllContribution,
	MeteStopAllStatusBar,
} from "../application/stop-all-command.js";

/** Binds "METE: Stop all", its key and its status bar button into the frontend container (ADR-065). */
export const bindStopAll = (bind: interfaces.Bind) => {
	bind(MeteStopAllContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(MeteStopAllContribution);
	bind(KeybindingContribution).toService(MeteStopAllContribution);
	bind(MeteStopAllStatusBar).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(MeteStopAllStatusBar);
};
