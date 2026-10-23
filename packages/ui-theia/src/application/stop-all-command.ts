import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import type {
	KeybindingContribution,
	KeybindingRegistry,
} from "@theia/core/lib/browser/keybinding";
import {
	StatusBar,
	StatusBarAlignment,
} from "@theia/core/lib/browser/status-bar/status-bar-types";
import { nls } from "@theia/core/lib/common/nls";
import { inject, injectable } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { MeteDaemonService } from "../domain/status-service.js";
import { failureText, noFolderText, plain } from "./status-text.js";

// The kill switch of SECURITY.md (ADR-065): "METE: Stop all", Ctrl+Shift+. and a status bar button.
// It asks nothing first, since an emergency stop must act at once.

/** The palette entry "METE: Stop all". */
export const STOP_ALL_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.stopAll", category: "METE", label: "Stop all" },
	"mete/stopAll/label",
	"mete/category",
);

/** Says how many runs Stop all cancelled. */
export const stopAllText = (cancelled: number) =>
	cancelled === 0
		? nls.localize(
				"mete/stopAll/none",
				"No run was going on; Stop all cancelled none.",
			)
		: nls.localize(
				"mete/stopAll/cancelled",
				"Stop all cancelled {0} run(s).",
				cancelled,
			);

@injectable()
export class MeteStopAllContribution
	implements CommandContribution, KeybindingContribution
{
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(STOP_ALL_COMMAND, {
			execute: () => this.stopAll(),
		});
	}

	// Registered after Theia's own, so it wins over the breadcrumb binding on the same keys.
	registerKeybindings(keybindings: KeybindingRegistry): void {
		keybindings.registerKeybinding({
			command: STOP_ALL_COMMAND.id,
			keybinding: "ctrlcmd+shift+.",
		});
	}

	// The daemon serves the first open folder; runs of other folders are not driven here.
	protected async stopAll(): Promise<void> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const r = await this.daemon.stopAll(root.resource.path.fsPath());
		if (r.ok) void this.messages.info(stopAllText(r.value.cancelled.length));
		else void this.messages.warn(failureText(r.error, plain));
	}
}

/** The "Stop all" button at the left of the status bar, always shown. */
@injectable()
export class MeteStopAllStatusBar implements FrontendApplicationContribution {
	@inject(StatusBar) protected readonly statusBar!: StatusBar;

	onStart(): void {
		void this.statusBar.setElement(STOP_ALL_COMMAND.id, {
			text: `$(debug-stop) ${nls.localize("mete/stopAll/label", "Stop all")}`,
			tooltip: nls.localize(
				"mete/stopAll/tooltip",
				"Cancel every run of this folder now (Ctrl+Shift+.)",
			),
			alignment: StatusBarAlignment.LEFT,
			priority: 1000,
			command: STOP_ALL_COMMAND.id,
		});
	}
}
