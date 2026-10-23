import { CommandService, MessageService } from "@theia/core";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import type { Message } from "@theia/core/shared/@lumino/messaging";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
// The design system of docs/13 on every METE panel (ADR-069); the bundle inlines its font.
import "../../style/mete.css";
import {
	type ComposerOption,
	narrowedTo,
	optionsOf,
	startOf,
} from "../application/composer.js";
import {
	type ComposerModel,
	ComposerView,
} from "../application/composer-view.js";
import { panelRoot } from "../application/panel-root.js";
import { failureText } from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { OPEN_BOARD_COMMAND } from "./board-contribution.js";
import { EDIT_TEAM_COMMAND } from "./team-editor-contribution.js";

// The run composer (docs/13, Run composer; ADR-071) of the first open folder: it asks the daemon for
// the templates and each one's estimate every time it opens, so a new `.mete/teams/` file shows.

/** The METE run composer in Theia's main area. */
@injectable()
export class MeteComposerWidget extends ReactWidget {
	static readonly ID = "mete.composer";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MessageService) protected readonly messages!: MessageService;

	protected model: ComposerModel = { kind: "loading" };
	protected dir: string | undefined;
	/** Every option, as the lists came; the shown ones narrow to the router's suggestions. */
	protected all: readonly ComposerOption[] = [];
	protected goal = "";
	protected selected = "choose";
	protected busy = false;
	protected error: string | undefined;
	protected pending: Promise<void> | undefined;

	@postConstruct()
	protected init(): void {
		this.id = MeteComposerWidget.ID;
		this.title.label = nls.localize("mete/composer/title", "Start a run");
		this.title.caption = nls.localize(
			"mete/composer/caption",
			"METE: start a run",
		);
		this.title.iconClass = codicon("play");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		void this.refresh();
	}

	// Opening the screen puts the cursor in the goal field (docs/13: keyboard-first), and coming back
	// to it asks for the teams again (ADR-071), so a team saved meanwhile shows; the first open's
	// refresh is still loading then, so it is not asked twice.
	protected override onActivateRequest(msg: Message): void {
		super.onActivateRequest(msg);
		this.node.querySelector("textarea")?.focus();
		if (this.model.kind === "ready" && !this.busy) void this.refresh();
	}

	/** Asks the daemon of the first open folder for its templates and their estimates. */
	refresh(): Promise<void> {
		// The command and the tab's activation may both ask at once: they share one round of requests.
		this.pending ??= this.load().finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}

	protected async load(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		this.dir = root.resource.path.fsPath();
		if (this.model.kind !== "ready") this.setModel({ kind: "loading" });
		// The templates, then each one's estimate and the single agent's at once; a cold daemon lists
		// the providers' models first, so the screen says it is busy.
		const listed = await this.daemon.templates(this.dir);
		const templates = listed.ok ? listed.value.templates : [];
		const ids = [...templates.map((t) => t.id), null];
		const dir = this.dir;
		const estimates = await Promise.all(
			ids.map((id) => this.daemon.estimate(dir, id)),
		);
		this.all = optionsOf(templates, estimates);
		this.selected = this.all.some((o) => o.key === this.selected)
			? this.selected
			: "choose";
		this.setModel({ kind: "ready", options: this.all, unsure: false });
	}

	// Start sends the goal and the pick; an unsure router narrows the list in place (ADR-047), and a
	// started run opens in the Team panel.
	protected async start(): Promise<void> {
		const option = this.options().find((o) => o.key === this.selected);
		if (!this.dir || !option || this.busy || !this.goal.trim()) return;
		this.busy = true;
		this.error = undefined;
		this.update();
		const r = await this.daemon.startRun(this.dir, startOf(this.goal, option));
		this.busy = false;
		if (r.ok) return this.started(r.value.runId);
		if (r.error.code === "choose_template") this.narrow(r.error.suggestions);
		else this.error = failureText(r.error);
		this.update();
	}

	protected options(): readonly ComposerOption[] {
		return this.model.kind === "ready" ? this.model.options : [];
	}

	protected narrow(suggestions: readonly string[] | undefined): void {
		const options = narrowedTo(suggestions ?? [], this.all);
		this.selected = options[0]?.key ?? "single";
		this.setModel({ kind: "ready", options, unsure: true });
	}

	protected started(runId: string): void {
		void this.messages.info(
			nls.localize("mete/run/started", "Run started: {0}", runId),
		);
		this.goal = "";
		this.selected = "choose";
		this.setModel({ kind: "ready", options: this.all, unsure: false });
		void this.commands.executeCommand(OPEN_BOARD_COMMAND.id, runId);
	}

	protected setModel(model: ComposerModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<ComposerView
					model={this.model}
					goal={this.goal}
					selected={this.selected}
					busy={this.busy}
					error={this.error}
					onGoal={(goal) => {
						this.goal = goal;
						this.update();
					}}
					onSelect={(key) => {
						this.selected = key;
						this.update();
					}}
					onStart={() => void this.start()}
					onEdit={(id) =>
						void this.commands.executeCommand(EDIT_TEAM_COMMAND.id, id)
					}
				/>
			</div>
		);
	}
}
