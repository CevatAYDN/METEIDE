import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { inject, injectable } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { MeteDaemonService } from "../domain/status-service.js";
import { quotaText } from "./quota-text.js";
import { failureText, noFolderText, plain, runsText } from "./status-text.js";

// "METE: Status" and "METE: Quota" in the command palette (docs/13, Design system: every METE
// action is a command).

/** The palette entry "METE: Status". */
export const STATUS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.status", category: "METE", label: "Status" },
	"mete/status/label",
	"mete/category",
);

/** The palette entry "METE: Quota": whether each provider can carry a run on now (ADR-050). */
export const QUOTA_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.quota", category: "METE", label: "Quota" },
	"mete/quota/label",
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
		commands.registerCommand(QUOTA_COMMAND, { execute: () => this.quota() });
	}

	// The daemon serves one folder, so both commands ask the daemon of the first open folder.
	protected folder(): string | undefined {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) void this.messages.info(noFolderText());
		return root?.resource.path.fsPath();
	}

	// The message stays on screen until it is closed.
	protected async status(): Promise<void> {
		const dir = this.folder();
		if (!dir) return;
		const r = await this.daemon.status(dir);
		if (r.ok) void this.messages.info(runsText(r.value, plain));
		else void this.messages.warn(failureText(r.error, plain));
	}

	protected async quota(): Promise<void> {
		const dir = this.folder();
		if (!dir) return;
		const r = await this.daemon.quota(dir);
		if (r.ok) void this.messages.info(quotaText(r.value.providers, plain));
		else void this.messages.warn(failureText(r.error, plain));
	}
}
