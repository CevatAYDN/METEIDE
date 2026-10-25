import type { Command } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import {
	StatusBar,
	StatusBarAlignment,
} from "@theia/core/lib/browser/status-bar/status-bar-types";
import { nls } from "@theia/core/lib/common/nls";
import { inject, injectable } from "@theia/core/shared/inversify";
import { OPEN_AUDIT_COMMAND } from "./audit-contribution.js";
import { OPEN_BOARD_COMMAND, START_RUN_COMMAND } from "./board-contribution.js";
import { OPEN_CHANGES_COMMAND } from "./changes-contribution.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { SHOW_SETTINGS_COMMAND } from "./settings-contribution.js";

// METE's screens one click away (docs/13, Screens; ADR-118): the status bar carries new run (the
// composer) beside the team panel, changes, quota, audit log and settings, each running the command
// the palette offers. A screen is therefore never reachable only from the palette, which stays the
// keyboard path (ADR-045 made every action a command; ADR-112 made a panel take focus when it opens).

/** One button of the row: its element id, icon, label and the command it runs. */
type Screen = {
	readonly id: string;
	readonly icon: string;
	readonly label: () => string;
	readonly command: Command;
};

const SCREENS: readonly Screen[] = [
	{
		id: "mete-screens-run",
		icon: "play",
		label: () => nls.localize("mete/home/newRun", "New run"),
		command: START_RUN_COMMAND,
	},
	{
		id: "mete-screens-team",
		icon: "organization",
		label: () => nls.localize("mete/screens/team", "Team panel"),
		command: OPEN_BOARD_COMMAND,
	},
	{
		id: "mete-screens-changes",
		icon: "diff",
		label: () => nls.localize("mete/screens/changes", "Changes"),
		command: OPEN_CHANGES_COMMAND,
	},
	{
		id: "mete-screens-quota",
		icon: "dashboard",
		label: () => nls.localize("mete/screens/quota", "Quota"),
		command: OPEN_QUOTA_COMMAND,
	},
	{
		id: "mete-screens-audit",
		icon: "shield",
		label: () => nls.localize("mete/screens/audit", "Audit"),
		command: OPEN_AUDIT_COMMAND,
	},
	{
		id: "mete-screens-settings",
		icon: "settings-gear",
		label: () => nls.localize("mete/screens/settings", "Settings"),
		command: SHOW_SETTINGS_COMMAND,
	},
];

// The waiting count sits at 999, leftmost; the screens follow it in the order above.
const FIRST_PRIORITY = 998;

/** The status bar's row of screens; each element runs the screen's command, as its menu entry does. */
@injectable()
export class MeteScreensStatusBar implements FrontendApplicationContribution {
	@inject(StatusBar) protected readonly statusBar!: StatusBar;

	onStart(): void {
		for (const [i, screen] of SCREENS.entries()) {
			const label = screen.label();
			void this.statusBar.setElement(screen.id, {
				text: `$(${screen.icon}) ${label}`,
				tooltip: screen.command.label ?? label,
				alignment: StatusBarAlignment.LEFT,
				priority: FIRST_PRIORITY - i,
				command: screen.command.id,
				accessibilityInformation: { label, role: "button" },
			});
		}
	}
}
