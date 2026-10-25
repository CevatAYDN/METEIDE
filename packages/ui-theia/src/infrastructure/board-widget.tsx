import type { ModelRef } from "@mete/contracts";
import { CommandService, MessageService } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { Message } from "@theia/core/shared/@lumino/messaging";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import {
	APPROVE_RUN_COMMAND,
	RESUME_RUN_COMMAND,
	REVISE_RUN_COMMAND,
} from "../application/approval-commands.js";
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
import type { RunFacts } from "../application/run-strip.js";
import { failureText, plain } from "../application/status-text.js";
import { roleNames, teamName } from "../application/team-draft.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { FlowView } from "./flow-view.js";
import { MetePanelWidget } from "./panel-widget.js";
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
export class MeteBoardWidget extends MetePanelWidget {
	static readonly ID = "mete.board";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(MeteRunComposer) protected readonly composer!: MeteRunComposer;
	@inject(MeteShownRun) protected readonly shownRun!: MeteShownRun;
	@inject(OpenerService) protected readonly openers!: OpenerService;

	protected session: BoardSession = IDLE_BOARD;
	/** False while the panel is hidden, so the Studio's stage stops (docs/13, Performance and access). */
	protected shown = true;
	protected mode: TeamMode = "board";
	/** The checkpoint a restore is in flight for (ADR-079). */
	protected restoring: string | undefined;
	/** The shown run's member names by role id, from its team file (ADR-089). */
	protected names: Readonly<Record<string, string>> = {};
	/** Each model's listed context window by `<providerId>/<modelId>`, for the Team view (ADR-090). */
	protected windows: Readonly<Record<string, number>> = {};
	/** What the daemon says of the shown run, and its team's name, for the run strip (ADR-094). */
	protected run: RunFacts = {};
	/** The models asked for already, so each is asked once per shown run. */
	protected asked = new Set<string>();
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
			this.events.onDidReceive(({ workspaceDir, event }) => {
				this.setSession(receiveBoard(this.session, workspaceDir, event));
				// A run's status, times and end come from the daemon, so each run.* event asks again.
				const shown = this.session.shown;
				if (
					shown &&
					event.runId === shown.runId &&
					event.type.startsWith("run.")
				)
					void this.loadRun(shown.dir, shown.runId);
			}),
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
		// The previous run's names never show on this one, also when its team file cannot be read.
		this.names = {};
		this.run = {};
		this.windows = {};
		this.asked = new Set();
		const shown = { dir, runId, goal };
		this.setSession(startBoard(shown));
		const r = await this.daemon.events(dir, runId);
		this.setSession(loadedBoard(this.session, shown, r));
		void this.loadRun(dir, runId);
		const created = r.ok
			? r.value.events.find((e) => e.type === "run.created")
			: undefined;
		if (created?.type === "run.created" && created.payload.templateId)
			void this.loadNames(dir, runId, created.payload.templateId);
	}

	// The run's entry of mete/status; a run another panel state replaced meanwhile is not drawn.
	protected async loadRun(dir: string, runId: string): Promise<void> {
		const r = await this.daemon.status(dir, runId);
		if (!r.ok || this.shownRun.runId !== runId) return;
		const run = r.value.find((x) => x.id === runId);
		if (run) this.run = { ...this.run, run };
		this.update();
	}

	// The names the team file gives now; a run of an edited or removed team keeps its role ids in words.
	protected async loadNames(dir: string, runId: string, templateId: string) {
		const t = await this.daemon.readTemplate(dir, templateId);
		if (
			!t.ok ||
			this.session.model.kind !== "board" ||
			this.shownRun.runId !== runId
		)
			return;
		this.names = roleNames(t.value.yaml);
		const name = teamName(t.value.yaml);
		this.run = { ...this.run, ...(name ? { teamName: name } : {}) };
		this.update();
	}

	// The strip's answers run ADR-048's commands with the shown run, as the Home view's buttons do.
	protected decide(command: string, feedback?: string) {
		const runId = this.shownRun.runId;
		if (!runId) return Promise.resolve();
		return this.commands.executeCommand(command, runId, feedback);
	}

	// Coming to the composer puts the cursor in the goal field (docs/13: keyboard-first) and asks for
	// the teams again (ADR-071); every other activation leaves the keyboard on the panel itself.
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

	// A report of the shown run, by its path relative to the run's folder (ADR-085).
	protected async openReport(path: string): Promise<void> {
		const shown = this.session.shown;
		if (!shown) return;
		try {
			await open(this.openers, URI.fromFilePath(shown.dir).resolve(path));
		} catch (e) {
			void this.messages.warn(String(e));
		}
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
		this.askWindows();
	}

	// The context windows of the models the shown run's calls used, each asked once (ADR-090); a
	// model the listing lacks keeps none, so its row shows the tokens alone.
	protected askWindows(): void {
		const { shown, view } = this.session;
		if (!shown) return;
		const key = (r: ModelRef) => `${r.providerId}/${r.modelId}`;
		const refs = new Map<string, ModelRef>();
		for (const a of view.agents) {
			const last = a.usage?.last;
			if (last && !this.asked.has(key(last)))
				refs.set(key(last), {
					providerId: last.providerId,
					modelId: last.modelId,
				});
		}
		if (refs.size === 0) return;
		for (const k of refs.keys()) this.asked.add(k);
		void this.loadWindows(shown.dir, shown.runId, [...refs.values()]);
	}

	protected async loadWindows(dir: string, runId: string, refs: ModelRef[]) {
		const r = await this.daemon.models(dir, refs);
		if (!r.ok || this.shownRun.runId !== runId) return;
		const got = r.value.models.map((m) => [
			`${m.providerId}/${m.id}`,
			m.contextWindow,
		]);
		this.windows = { ...this.windows, ...Object.fromEntries(got) };
		this.update();
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
					onOpenReport: (path) => void this.openReport(path),
					names: this.names,
					windows: this.windows,
					run: this.run,
					waiting: {
						onApprove: () => void this.decide(APPROVE_RUN_COMMAND.id),
						onRevise: (feedback) =>
							void this.decide(REVISE_RUN_COMMAND.id, feedback),
						onResume: () => void this.decide(RESUME_RUN_COMMAND.id),
					},
				}}
			/>
		);
	}
}
