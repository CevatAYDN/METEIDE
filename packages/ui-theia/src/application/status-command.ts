import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { nls } from "@theia/core/lib/common/nls";
import { inject, injectable } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { MeteDaemonService } from "../domain/status-service.js";
import { failureText, runsText } from "./status-text.js";

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
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(STATUS_COMMAND, { execute: () => this.status() });
	}

	// Asks the daemon of the first open folder; the message stays on screen until it is closed.
	protected async status(): Promise<void> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) {
			void this.messages.info(
				nls.localize(
					"mete/status/noFolder",
					"Open a folder first: METE works on one folder at a time.",
				),
			);
			return;
		}
		const r = await this.daemon.status(root.resource.path.fsPath());
		if (r.ok) void this.messages.info(runsText(r.value));
		else void this.messages.warn(failureText(r.error));
	}
}
