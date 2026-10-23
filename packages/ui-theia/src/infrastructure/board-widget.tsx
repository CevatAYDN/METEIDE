import { CommandService } from "@theia/core";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import { getThemeMode } from "@theia/core/lib/common/theme";
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
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { panelRoot } from "../application/panel-root.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { FlowView } from "./flow-view.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { StudioView } from "./studio-view.js";

// The Team panel (docs/13; ADR-051): one chosen run on the Board or as the Flow graph. The order of
// history and live events is the session's (application/board-session.ts); the widget listens, asks
// and draws. Its id stays mete.board from when the Board was its only view (ids are not shown).

/** The METE Team panel in Theia's main area. */
@injectable()
export class MeteBoardWidget extends ReactWidget {
	static readonly ID = "mete.board";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;

	protected session: BoardSession = IDLE_BOARD;
	/** False while the panel is hidden, so the Studio's stage stops (docs/13, Performance and access). */
	protected shown = true;
	protected mode: TeamMode = "board";

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
		this.update();
	}

	/** Shows the run: its history first, then its live events. */
	async showRun(dir: string, runId: string, goal: string): Promise<void> {
		const shown = { dir, runId, goal };
		this.setSession(startBoard(shown));
		const r = await this.daemon.events(dir, runId);
		this.setSession(loadedBoard(this.session, shown, r));
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
								mode={getThemeMode(this.themes.getCurrentTheme().type)}
								active={this.shown}
								onCoffee={() =>
									void this.commands.executeCommand(OPEN_QUOTA_COMMAND.id)
								}
								{...(pulse ? { pulse } : {})}
							/>
						),
					}}
				/>
			</div>
		);
	}
}
