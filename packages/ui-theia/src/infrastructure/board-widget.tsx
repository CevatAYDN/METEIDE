import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
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
import { BoardView } from "../application/board-view.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { MeteDaemonService } from "../domain/status-service.js";

// The Board panel (docs/13, Team panel; ADR-051): one chosen run. The order of history and live
// events is the session's (application/board-session.ts); the widget listens, asks and draws.

/** The METE Board view in Theia's main area. */
@injectable()
export class MeteBoardWidget extends ReactWidget {
	static readonly ID = "mete.board";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;

	protected session: BoardSession = IDLE_BOARD;

	@postConstruct()
	protected init(): void {
		this.id = MeteBoardWidget.ID;
		this.title.label = nls.localize("mete/board/title", "Board");
		this.title.caption = nls.localize(
			"mete/board/caption",
			"METE: a run's tasks",
		);
		this.title.iconClass = codicon("project");
		this.title.closable = true;
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

	protected setSession(next: BoardSession): void {
		const drawn = next.model !== this.session.model;
		this.session = next;
		if (drawn) this.update();
	}

	protected override render() {
		return <BoardView model={this.session.model} />;
	}
}
