import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	type MenuContribution,
	type MenuModelRegistry,
	MessageService,
} from "@theia/core";
import { CommonMenus } from "@theia/core/lib/browser/common-menus";
import { nls } from "@theia/core/lib/common/nls";
import { inject, injectable } from "@theia/core/shared/inversify";
import {
	MeteUpdateService,
	type UpdateState,
} from "../domain/update-service.js";

// "Check for Updates…" in the Help menu (ADR-137). Each answer is one true sentence, so a release
// that was never published does not read as a broken check.

/** The Help menu and palette entry. */
export const CHECK_UPDATES_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.checkForUpdates", category: "METE", label: "Check for Updates…" },
	"mete/update/label",
	"mete/category",
);

/** What a check found, as one sentence. */
export const updateText = (state: UpdateState): string => {
	switch (state.kind) {
		case "source":
			return nls.localize(
				"mete/update/source",
				"This METE IDE runs from source, not from an installed copy, so it does not update itself.",
			);
		case "unpublished":
			return nls.localize(
				"mete/update/unpublished",
				"No METE IDE release has been published yet, so there is nothing to update to. This is version {0}.",
				state.current,
			);
		case "latest":
			return nls.localize(
				"mete/update/latest",
				"METE IDE {0} is the newest version.",
				state.current,
			);
		case "ready":
			return nls.localize(
				"mete/update/ready",
				"METE IDE {0} is downloaded. Restart to install it.",
				state.version,
			);
		case "failed":
			return nls.localize(
				"mete/update/failed",
				"Could not check for updates: {0}",
				state.message,
			);
	}
};

@injectable()
export class MeteUpdateContribution
	implements CommandContribution, MenuContribution
{
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(MeteUpdateService) protected readonly updates!: MeteUpdateService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(CHECK_UPDATES_COMMAND, {
			execute: () => this.check(),
		});
	}

	registerMenus(menus: MenuModelRegistry): void {
		menus.registerMenuAction(CommonMenus.HELP, {
			commandId: CHECK_UPDATES_COMMAND.id,
		});
	}

	// A newer release downloads before it is offered, which can take a while; the progress says so.
	protected async check(): Promise<void> {
		const progress = await this.messages.showProgress({
			text: nls.localize("mete/update/checking", "Checking for updates…"),
		});
		const state = await this.updates.check().finally(() => progress.cancel());
		if (state.kind === "failed")
			return void this.messages.warn(updateText(state));
		if (state.kind !== "ready")
			return void this.messages.info(updateText(state));
		const restart = nls.localize("mete/update/restart", "Restart now");
		if ((await this.messages.info(updateText(state), restart)) === restart)
			await this.updates.install();
	}
}
