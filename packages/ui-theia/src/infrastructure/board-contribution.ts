import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { Command, type CommandRegistry, MessageService } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	type FrontendApplicationContribution,
	FrontendApplicationContribution as FrontendApplicationContributionId,
	WidgetFactory,
} from "@theia/core/lib/browser";
import {
	KeybindingContribution,
	type KeybindingRegistry,
} from "@theia/core/lib/browser/keybinding";
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
import { restoredText } from "../application/checkpoint-list.js";
import {
	failureText,
	noFolderText,
	plain,
} from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { MeteBoardWidget } from "./board-widget.js";
import { MeteRunComposer } from "./run-composer.js";
import { MeteShownRun } from "./shown-run.js";

// The Team panel's place in Theia, the one run view in the main area (docs/13, Team panel; ADR-051,
// ADR-078): "METE: Open team panel" picks one of the folder's runs and shows it there, "METE: Start
// run" shows the composer there, and a fresh layout opens it.

/** The palette entry "METE: Start run", which the METE view's New run button runs too (ADR-071). */
export const START_RUN_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.start", category: "METE", label: "Start run" },
	"mete/run/start",
	"mete/category",
);

/** The palette entry "METE: Open team panel" (its id is from when the Board was its only view). */
export const OPEN_BOARD_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.board.open", category: "METE", label: "Open team panel" },
	"mete/board/open",
	"mete/category",
);

/** The palette entry "METE: Restore checkpoint" (ADR-079): a run, then one of its checkpoints. */
export const RESTORE_CHECKPOINT_COMMAND: Command = Command.toLocalizedCommand(
	{
		id: "mete.checkpoint.restore",
		category: "METE",
		label: "Restore checkpoint",
	},
	"mete/checkpoint/command",
	"mete/category",
);

type ChosenRun = {
	readonly dir: string;
	readonly runId: string;
	readonly goal: string;
};

type RunPick = QuickPickItem & {
	readonly runId: string;
	readonly goal: string;
};

@injectable()
export class MeteBoardContribution
	extends AbstractViewContribution<MeteBoardWidget>
	implements FrontendApplicationContribution, KeybindingContribution
{
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
			execute: async (runId?: unknown) => {
				const run = await this.pick(runId);
				if (run) await this.show(run);
			},
		});
		commands.registerCommand(RESTORE_CHECKPOINT_COMMAND, {
			execute: async (runId?: unknown) => {
				const run = await this.pick(runId);
				if (run) await this.restoreOne(run);
			},
		});
		commands.registerCommand(START_RUN_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).showComposer(),
		});
	}

	override registerKeybindings(keybindings: KeybindingRegistry): void {
		keybindings.registerKeybinding({
			command: START_RUN_COMMAND.id,
			keybinding: "ctrlcmd+shift+enter",
		});
	}

	/** Puts the Team panel in the main area of a fresh layout, where it shows the composer. */
	async initializeLayout(): Promise<void> {
		await this.openView();
	}

	protected async show(run: ChosenRun) {
		const widget = await this.openView({ activate: true, reveal: true });
		await widget.showRun(run.dir, run.runId, run.goal);
	}

	// One of the run's checkpoints, from its history folded as the Team panel folds it; the panel then
	// shows the run, so the list is in view.
	protected async restoreOne(run: ChosenRun): Promise<void> {
		const history = await this.daemon.events(run.dir, run.runId);
		if (!history.ok)
			return void this.messages.warn(failureText(history.error, plain));
		const { checkpoints } = applyAll(
			run.runId,
			EMPTY_TEAM_VIEW,
			history.value.events,
		);
		const picks = [...checkpoints].reverse().map((c) => ({
			label: `#${c.n}`,
			description: new Date(c.at).toLocaleString(),
			id: c.id,
		}));
		if (picks.length === 0)
			return void this.messages.info(
				nls.localize("mete/checkpoint/none", "This run has no checkpoints."),
			);
		const chosen = await this.quick.pick(picks, {
			placeHolder: nls.localize("mete/checkpoint/which", "Which checkpoint?"),
		});
		if (!chosen) return;
		await this.show(run);
		const r = await this.daemon.checkpointRestore(
			run.dir,
			run.runId,
			chosen.id,
		);
		if (!r.ok) return void this.messages.warn(failureText(r.error, plain));
		void this.messages.info(restoredText(r.value));
	}

	// The run the command was given (a Home row), or one picked among the folder's runs, which come
	// newest first from mete/status.
	protected async pick(given: unknown): Promise<ChosenRun | undefined> {
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
		return pick ? { dir, runId: pick.runId, goal: pick.goal } : undefined;
	}

	protected choose(picks: RunPick[]) {
		return this.quick.pick(picks, {
			placeHolder: nls.localize("mete/run/which", "Which run?"),
		});
	}
}

/** Binds the Team panel, its composer, its factory and its contribution into the frontend container. */
export const bindBoard = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteBoardContribution);
	bind(FrontendApplicationContributionId).toService(MeteBoardContribution);
	bind(KeybindingContribution).toService(MeteBoardContribution);
	bind(MeteBoardWidget).toSelf();
	bind(MeteRunComposer).toSelf();
	bind(MeteShownRun).toSelf().inSingletonScope();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteBoardWidget.ID,
			createWidget: () => ctx.container.get(MeteBoardWidget),
		}))
		.inSingletonScope();
};
