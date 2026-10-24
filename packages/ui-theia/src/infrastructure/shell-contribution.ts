import {
	MAIN_MENU_BAR,
	MenuContribution,
	type MenuModelRegistry,
} from "@theia/core";
import { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import {
	StatusBar,
	StatusBarAlignment,
} from "@theia/core/lib/browser/status-bar/status-bar";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	type interfaces,
} from "@theia/core/shared/inversify";
import { STOP_ALL_COMMAND } from "../application/stop-all-command.js";
import { waitingCount } from "../domain/home-model.js";
import { OPEN_AUDIT_COMMAND } from "./audit-contribution.js";
import { OPEN_BOARD_COMMAND, START_RUN_COMMAND } from "./board-contribution.js";
import { SHOW_WAITING_COMMAND } from "./home-contribution.js";
import { MeteHomeStore } from "./home-store.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { EDIT_TEAM_COMMAND } from "./team-editor-contribution.js";

// METE's place in Theia's chrome (ADR-078): the METE menu of the menu bar, before Help ("9_help"),
// and the status bar item that counts the runs waiting for the user while there are any.

/** The METE menu of the menu bar. */
export const METE_MENU = [...MAIN_MENU_BAR, "8_mete"];

// Each group is a block of the menu; Stop all stands apart, as the kill switch (SECURITY.md).
const ITEMS = [
	["1_run", [START_RUN_COMMAND, OPEN_BOARD_COMMAND]],
	["2_screens", [OPEN_QUOTA_COMMAND, OPEN_AUDIT_COMMAND, EDIT_TEAM_COMMAND]],
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

const WAITING_ID = "mete.waiting";

/** "N waiting for you" at the left of the status bar while a run waits; a click shows them. */
@injectable()
export class MeteWaitingStatusBar implements FrontendApplicationContribution {
	@inject(StatusBar) protected readonly statusBar!: StatusBar;
	@inject(MeteHomeStore) protected readonly store!: MeteHomeStore;
	protected shown = 0;

	onStart(): void {
		this.store.onDidChange(() => void this.draw());
		void this.draw();
	}

	protected async draw(): Promise<void> {
		const count = waitingCount(this.store.model);
		if (count === this.shown) return;
		this.shown = count;
		if (count === 0) return this.statusBar.removeElement(WAITING_ID);
		await this.statusBar.setElement(WAITING_ID, {
			text: `$(bell-dot) ${nls.localize("mete/home/waitingCount", "{0} waiting for you", count)}`,
			tooltip: nls.localize(
				"mete/home/waitingBadge",
				"{0} run(s) wait for you",
				count,
			),
			alignment: StatusBarAlignment.LEFT,
			priority: 999,
			command: SHOW_WAITING_COMMAND.id,
		});
	}
}

/** Binds the METE menu and the waiting count into the frontend container. */
export const bindShell = (bind: interfaces.Bind) => {
	bind(MenuContribution).to(MeteMenuContribution).inSingletonScope();
	bind(MeteWaitingStatusBar).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(MeteWaitingStatusBar);
};
