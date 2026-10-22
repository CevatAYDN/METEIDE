import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { nls } from "@theia/core/lib/common/nls";
import { inject, injectable } from "@theia/core/shared/inversify";

// "METE: Status" in the command palette (docs/13, Design system: every METE action is a command).

/** The palette entry "METE: Status". */
export const STATUS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.status", category: "METE", label: "Status" },
	"mete/status/label",
	"mete/category",
);

@injectable()
export class MeteCommandContribution implements CommandContribution {
	// Property injection, as Theia's own classes do it.
	@inject(MessageService) protected readonly messages!: MessageService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(STATUS_COMMAND, {
			execute: () => {
				// shortcut: the daemon connection arrives with the backend module; until then there is nothing to ask.
				void this.messages.info(
					nls.localize(
						"mete/status/notConnected",
						"METE is not connected to the daemon yet.",
					),
				);
			},
		});
	}
}
