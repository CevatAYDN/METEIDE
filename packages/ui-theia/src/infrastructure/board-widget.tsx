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
import {
	type BoardSession,
	IDLE_BOARD,
	loadedBoard,
	receiveBoard,
	startBoard,
} from "../application/board-session.js";
import { BoardView, type TeamMode } from "../application/board-view.js";
import { restoredText } from "../application/checkpoint-list.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { panelRoot } from "../application/panel-root.js";
import { failureText, plain } from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { FlowView } from "./flow-view.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { MeteRunComposer } from "./run-composer.js";
import { MeteShownRun } from "./shown-run.js";
import { StudioView } from "./studio-view.js";

// The Team panel (docs/13; ADR-051): one chosen run on the Board, as the Flow graph or in the Studio,
// and the run composer while it shows no run (ADR-078), so a started run takes the composer's place.
// The order of history and live events is the session's (application/board-session.ts); the widget
// listens, asks and draws. Its id stays mete.board from when the Board was its only view.

/** The METE Team panel in Theia's main area. */
@injectable()
export class MeteBoardWidget extends ReactWidget {
	static readonly ID = "mete.board";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(MeteRunComposer) protected readonly composer!: MeteRunComposer;
	@inject(MeteShownRun) protected readonly shownRun!: MeteShownRun;

	protected session: BoardSession = IDLE_BOARD;
	/** False while the panel is hidden, so the Studio's stage stops (docs/13, Performance and access). */
	protected shown = true;
	protected mode: TeamMode = "board";
	/** The checkpoint a restore is in flight for (ADR-079). */
	protected restoring: string | undefined;
	/** True while the panel shows the composer, which it also shows before any run. */
	protected composing = true;

	@postConstruct()
	protected init(): void {
		this.id = MeteBoardWidget.ID;
		this.title.label = nls.localize("mete/board/title", "Team panel");
		this.title.caption = nls.localize(
			"mete/board/caption",
			"METE: a run's tasks",
		);
		this.title.iconClass = codicon("project");
		this.title.closable = true;
		// The panel and the Studio's stage take the tokens of Theia's theme (ADR-052, ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.toDispose.push(
			this.events.onDidReceive(({ workspaceDir, event }) =>
				this.setSession(receiveBoard(this.session, workspaceDir, event)),
			),
		);
		this.toDispose.push(this.composer.onDidChange(() => this.update()));
		this.toDispose.push(
			this.composer.onDidStart(
				({ dir, runId, goal }) => void this.showRun(dir, runId, goal),
			),
		);
		// A closed panel shows no run, so Runs marks none.
		this.toDispose.push({ dispose: () => this.shownRun.set(undefined) });
		void this.composer.reopen();
		this.update();
	}

	/** Shows the run composer in place of the run. */
	showComposer(): Promise<void> {
		this.composing = true;
		this.shownRun.set(undefined);
		this.update();
		return this.composer.reopen();
	}

	/** Shows the run: its history first, then its live events. */
	async showRun(dir: string, runId: string, goal: string): Promise<void> {
		this.composing = false;
		this.shownRun.set(runId);
		const shown = { dir, runId, goal };
		this.setSession(startBoard(shown));
		const r = await this.daemon.events(dir, runId);
		this.setSession(loadedBoard(this.session, shown, r));
	}

	// Coming to the composer puts the cursor in the goal field (docs/13: keyboard-first) and asks for
	// the teams again (ADR-071).
	protected override onActivateRequest(msg: Message): void {
		super.onActivateRequest(msg);
		if (!this.showsComposer()) return;
		this.node.querySelector("textarea")?.focus();
		void this.composer.reopen();
	}

	protected showsComposer() {
		return this.composing || this.session.model.kind === "no_run";
	}

	// Restores one of the shown run's checkpoints; the list updates from the live events it causes
	// (checkpoint.created for the undo, rollback.performed), and a refusal says why.
	protected async restore(checkpointId: string): Promise<void> {
		const shown = this.session.shown;
		if (!shown || this.restoring) return;
		this.restoring = checkpointId;
		this.update();
		const r = await this.daemon.checkpointRestore(
			shown.dir,
			shown.runId,
			checkpointId,
		);
		this.restoring = undefined;
		this.update();
		if (!r.ok) return void this.messages.warn(failureText(r.error, plain));
		void this.messages.info(restoredText(r.value));
	}

	protected override onAfterShow(msg: Message): void {
		super.onAfterShow(msg);
		this.shown = true;
		this.update();
	}

	protected override onAfterHide(msg: Message): void {
		super.onAfterHide(msg);
		this.shown = false;
		this.update();
	}

	protected setSession(next: BoardSession): void {
		const drawn = next.model !== this.session.model;
		this.session = next;
		if (drawn) this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				{this.showsComposer() ? this.composer.render() : this.board()}
			</div>
		);
	}

	protected board() {
		return (
			<BoardView
				model={this.session.model}
				controls={{
					mode: this.mode,
					onMode: (mode) => {
						this.mode = mode;
						this.update();
					},
					flow: (view) => <FlowView view={view} />,
					studio: (view, pulse) => (
						<StudioView
							view={view}
							active={this.shown}
							onCoffee={() =>
								void this.commands.executeCommand(OPEN_QUOTA_COMMAND.id)
							}
							{...(pulse ? { pulse } : {})}
						/>
					),
					restore: {
						onRestore: (id) => void this.restore(id),
						restoring: this.restoring,
					},
				}}
			/>
		);
	}
}
