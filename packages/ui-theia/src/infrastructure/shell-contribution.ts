import {
	MAIN_MENU_BAR,
	MenuContribution,
	type MenuModelRegistry,
} from "@theia/core";
import { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { STOP_ALL_COMMAND } from "../application/stop-all-command.js";
import { OPEN_AUDIT_COMMAND } from "./audit-contribution.js";
import { OPEN_BOARD_COMMAND, START_RUN_COMMAND } from "./board-contribution.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { SHOW_SETTINGS_COMMAND } from "./settings-contribution.js";
import { EDIT_TEAM_COMMAND } from "./team-editor-contribution.js";
import { MeteWaitingStatusBar } from "./waiting.js";
import { OPEN_WELCOME_COMMAND } from "./welcome-contribution.js";

// METE's place in Theia's chrome (ADR-078): the METE menu of the menu bar, before Help ("9_help"),
// and the status bar item that counts the runs waiting for the user while there are any.

/** The METE menu of the menu bar. */
export const METE_MENU = [...MAIN_MENU_BAR, "8_mete"];

// Each group is a block of the menu; Stop all stands apart, as the kill switch (SECURITY.md).
const ITEMS = [
	["1_run", [START_RUN_COMMAND, OPEN_BOARD_COMMAND]],
	[
		"2_screens",
		[
			OPEN_QUOTA_COMMAND,
			OPEN_AUDIT_COMMAND,
			EDIT_TEAM_COMMAND,
			SHOW_SETTINGS_COMMAND,
			OPEN_WELCOME_COMMAND,
		],
	],
	["3_stop", [STOP_ALL_COMMAND]],
] as const;

@injectable()
export class MeteMenuContribution implements MenuContribution {
	registerMenus(menus: MenuModelRegistry): void {
		menus.registerSubmenu(METE_MENU, "METE");
		for (const [group, commands] of ITEMS)
			for (const [i, c] of commands.entries())
				menus.registerMenuAction([...METE_MENU, group], {
					commandId: c.id,
					order: String(i),
				});
	}
}

/** Binds the METE menu and the waiting count into the frontend container. */
export const bindShell = (bind: interfaces.Bind) => {
	bind(MenuContribution).to(MeteMenuContribution).inSingletonScope();
	bind(MeteWaitingStatusBar).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(MeteWaitingStatusBar);
};
