import { Command, type CommandRegistry, MessageService } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import {
	QuickInputService,
	type QuickPickItem,
} from "@theia/core/lib/common/quick-pick-service";
import {
	inject,
	injectable,
	type interfaces,
} from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	failureText,
	noFolderText,
	plain,
} from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { MeteBoardWidget } from "./board-widget.js";

// The Board's place in Theia: "METE: Open board" picks one of the folder's runs and shows it in the
// main area (docs/13, Team panel; ADR-051).

/** The palette entry "METE: Open board". */
export const OPEN_BOARD_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.board.open", category: "METE", label: "Open board" },
	"mete/board/open",
	"mete/category",
);

type RunPick = QuickPickItem & {
	readonly runId: string;
	readonly goal: string;
};

@injectable()
export class MeteBoardContribution extends AbstractViewContribution<MeteBoardWidget> {
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;

	constructor() {
		super({
			widgetId: MeteBoardWidget.ID,
			widgetName: nls.localize("mete/board/title", "Board"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_BOARD_COMMAND, {
			execute: () => this.pick(),
		});
	}

	// The runs come newest first from mete/status; the one picked opens in the Board.
	protected async pick(): Promise<void> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const dir = root.resource.path.fsPath();
		const runs = await this.daemon.status(dir);
		if (!runs.ok)
			return void this.messages.warn(failureText(runs.error, plain));
		const picks: RunPick[] = runs.value.map((r) => ({
			label: r.goal,
			description: `${r.status} · ${r.templateId ?? nls.localize("mete/run/single", "Single agent")}`,
			runId: r.id,
			goal: r.goal,
		}));
		if (picks.length === 0)
			return void this.messages.info(
				nls.localize("mete/status/none", "No runs in this folder yet."),
			);
		const pick = await this.quick.pick(picks, {
			placeHolder: nls.localize("mete/run/which", "Which run?"),
		});
		if (!pick) return;
		const widget = await this.openView({ activate: true, reveal: true });
		await widget.showRun(dir, pick.runId, pick.goal);
	}
}

/** Binds the Board view, its factory and its contribution into the frontend container. */
export const bindBoard = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteBoardContribution);
	bind(MeteBoardWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteBoardWidget.ID,
			createWidget: () => ctx.container.get(MeteBoardWidget),
		}))
		.inSingletonScope();
};
