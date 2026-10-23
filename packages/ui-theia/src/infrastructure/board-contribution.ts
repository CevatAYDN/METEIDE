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

// The Team panel's place in Theia: "METE: Open team panel" picks one of the folder's runs and shows it in the
// main area (docs/13, Team panel; ADR-051).

/** The palette entry "METE: Open team panel" (its id is from when the Board was its only view). */
export const OPEN_BOARD_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.board.open", category: "METE", label: "Open team panel" },
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
			widgetName: nls.localize("mete/board/title", "Team panel"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_BOARD_COMMAND, {
			execute: (runId?: unknown) => this.pick(runId),
		});
	}

	// The run the command was given (a Home row), or one picked among the folder's runs, which come
	// newest first from mete/status.
	protected async pick(given: unknown): Promise<void> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const dir = root.resource.path.fsPath();
		const runId = typeof given === "string" && given ? given : undefined;
		const runs = await this.daemon.status(dir, runId);
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
		const pick = runId ? picks[0] : await this.choose(picks);
		if (!pick) return;
		const widget = await this.openView({ activate: true, reveal: true });
		await widget.showRun(dir, pick.runId, pick.goal);
	}

	protected choose(picks: RunPick[]) {
		return this.quick.pick(picks, {
			placeHolder: nls.localize("mete/run/which", "Which run?"),
		});
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
