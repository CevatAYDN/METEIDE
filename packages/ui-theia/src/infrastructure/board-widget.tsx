import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { type BoardModel, BoardView } from "../application/board-view.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { MeteDaemonService } from "../domain/status-service.js";

// The Board panel (docs/13, Team panel; ADR-051): one chosen run, drawn from the fold of
// @mete/ui-studio. The order matters: the fold records an event id even when the event changed
// nothing, so a status change applied before its task.created would be lost for good. So the panel
// listens first and buffers the run's live events, then reads the history, folds it, folds the
// buffer, and only then folds live events as they come; the fold skips the ones the history had.

type Shown = {
	readonly dir: string;
	readonly runId: string;
	readonly goal: string;
};

/** The METE Board view in Theia's main area. */
@injectable()
export class MeteBoardWidget extends ReactWidget {
	static readonly ID = "mete.board";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;

	protected model: BoardModel = { kind: "no_run" };
	protected shown: Shown | undefined;
	protected view: TeamView = EMPTY_TEAM_VIEW;
	protected unreadable = 0;
	/** The run's live events while its history is read; undefined once it is folded. */
	protected buffer: MeteEvent[] | undefined;

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
			this.events.onDidReceive(({ workspaceDir, event }) => {
				const s = this.shown;
				if (!s || workspaceDir !== s.dir || event.runId !== s.runId) return;
				if (this.buffer) this.buffer.push(event);
				else this.fold([event]);
			}),
		);
		this.update();
	}

	/** Shows the run: its history first, then its live events. */
	async showRun(dir: string, runId: string, goal: string): Promise<void> {
		const shown = { dir, runId, goal };
		this.shown = shown;
		this.view = EMPTY_TEAM_VIEW;
		this.buffer = [];
		this.setModel({ kind: "loading" });
		const r = await this.daemon.events(dir, runId);
		// Another run was chosen while this history was read: that one draws.
		if (this.shown !== shown) return;
		const live = this.buffer ?? [];
		this.buffer = undefined;
		if (!r.ok) return this.setModel({ kind: "failed", failure: r.error });
		this.unreadable = r.value.unreadable;
		this.view = applyAll(runId, EMPTY_TEAM_VIEW, r.value.events);
		this.fold(live, true);
	}

	protected fold(events: readonly MeteEvent[], draw = false): void {
		const s = this.shown;
		if (!s) return;
		const next = applyAll(s.runId, this.view, events);
		if (next === this.view && !draw) return;
		this.view = next;
		if (draw || this.model.kind === "board")
			this.setModel({
				kind: "board",
				goal: s.goal,
				view: next,
				unreadable: this.unreadable,
			});
	}

	protected setModel(model: BoardModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return <BoardView model={this.model} />;
	}
}
