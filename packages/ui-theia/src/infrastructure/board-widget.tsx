import type { AllowScope, ModelRef } from "@mete/contracts";
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
import {
	BoardView,
	type TeamControls,
	type TeamMode,
} from "../application/board-view.js";
import { restoredText } from "../application/checkpoint-list.js";
import { unaskedModels, windowsOf } from "../application/context-meter.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import {
	createModelSession,
	type ModelSession,
} from "../application/model-session.js";
import { panelRoot } from "../application/panel-root.js";
import type { RunFacts } from "../application/run-strip.js";
import { failureText, plain } from "../application/status-text.js";
import { roleNames, teamName } from "../application/team-draft.js";
import { createTranscriptSession } from "../application/transcript-session.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { FlowView } from "./flow-view.js";
import { MetePanelWidget } from "./panel-widget.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { MeteRunComposer } from "./run-composer.js";
import { MeteShownRun } from "./shown-run.js";
import { StudioView } from "./studio-view.js";
import "../../style/mete-run.css";
import "../../style/mete-side.css";

// The Team panel (docs/13; ADR-051; ADR-078; ADR-122).
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
	protected shown = true;
	protected mode: TeamMode = "board";
	protected restoring: string | undefined;
	protected names: Readonly<Record<string, string>> = {};
	protected windows: Readonly<Record<string, number>> = {};
	protected run: RunFacts = {};
	protected asked = new Set<string>();
	protected composing = true;
	// The shown run's model choice (ADR-122); made once the daemon is injected.
	protected models!: ModelSession;
	// The shown run's steps (ADR-125); the daemon is injected before the first call.
	protected readonly transcripts = createTranscriptSession({
		fetch: (dir, runId) => this.daemon.transcript(dir, runId),
		onChange: () => this.update(),
	});

	@postConstruct()
	protected init(): void {
		this.models = createModelSession({
			daemon: this.daemon,
			onChange: () => this.update(),
			warn: (text) => void this.messages.warn(text),
		});
		this.id = MeteBoardWidget.ID;
		this.title.label = nls.localize("mete/board/title", "Team panel");
		this.title.caption = nls.localize(
			"mete/board/caption",
			"METE: a run's tasks",
		);
		this.title.iconClass = codicon("project");
		this.title.closable = true;
		this.toDispose.pushAll([
			this.themes.onDidColorThemeChange(() => this.update()),
			this.events.onDidReceive(({ workspaceDir, event }) => {
				this.setSession(receiveBoard(this.session, workspaceDir, event));
				this.transcripts.onEvent(event);
				const shown = this.session.shown;
				if (shown && event.runId === shown.runId) {
					if (event.type === "run.created")
						this.models.setTemplate(event.payload.templateId);
					if (event.type.startsWith("run."))
						void this.loadRun(shown.dir, shown.runId);
				}
			}),
			this.composer.onDidChange(() => this.update()),
			this.composer.onDidStart(
				(s) => void this.showRun(s.dir, s.runId, s.goal),
			),
			{ dispose: () => this.shownRun.set(undefined) },
			{ dispose: () => this.transcripts.dispose() },
		]);
		void this.composer.reopen();
		this.update();
	}

	/** Shows the run composer in place of the run. */
	showComposer(): Promise<void> {
		this.composing = true;
		this.shownRun.set(undefined);
		this.tickThinking();
		this.update();
		return this.composer.reopen();
	}

	/** Shows the run: its history first, then its live events. */
	async showRun(dir: string, runId: string, goal: string): Promise<void> {
		this.composing = false;
		this.shownRun.set(runId);
		this.names = {};
		this.run = {};
		this.windows = {};
		this.asked = new Set();
		this.models.show(dir, runId);
		const shown = { dir, runId, goal };
		this.setSession(startBoard(shown));
		this.transcripts.show(dir, runId);
		const r = await this.daemon.events(dir, runId);
		const created = r.ok
			? r.value.events.find((e) => e.type === "run.created")
			: undefined;
		// Before the first agents reach the view: a single-agent run asks its chain for tool calling.
		if (created?.type === "run.created")
			this.models.setTemplate(created.payload.templateId);
		this.setSession(loadedBoard(this.session, shown, r));
		void this.loadRun(dir, runId);
		if (created?.type === "run.created" && created.payload.templateId)
			void this.loadNames(dir, runId, created.payload.templateId);
	}

	// The run's entry of mete/status; a run another panel state replaced meanwhile is not drawn.
	protected async loadRun(dir: string, runId: string): Promise<void> {
		const r = await this.daemon.status(dir, runId);
		if (!r.ok || this.shownRun.runId !== runId) return;
		const run = r.value.find((x) => x.id === runId);
		if (!run) return;
		this.run = { ...this.run, run };
		this.models.onRun(run, this.session.view.agents[0]?.roleId ?? "assistant");
		this.update();
	}

	// The names the team file gives now; a run of an edited or removed team keeps its role ids in words.
	protected async loadNames(dir: string, runId: string, templateId: string) {
		const t = await this.daemon.readTemplate(dir, templateId);
		const stale =
			this.session.model.kind !== "board" || this.shownRun.runId !== runId;
		if (!t.ok || stale) return;
		this.names = roleNames(t.value.yaml);
		const name = teamName(t.value.yaml);
		this.run = { ...this.run, ...(name ? { teamName: name } : {}) };
		this.update();
		void this.models.loadTemplate(t.value.yaml);
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
		this.tickThinking();
		this.update();
	}

	protected override onAfterHide(msg: Message): void {
		super.onAfterHide(msg);
		this.shown = false;
		this.tickThinking();
		this.update();
	}

	protected setSession(next: BoardSession): void {
		const drawn = next.model !== this.session.model;
		this.session = next;
		if (drawn) this.update();
		this.tickThinking();
		this.askWindows();
		void this.models.askChains(this.session.view.agents);
	}

	// The context windows of the models the shown run's calls used, each asked once (ADR-090); a
	// model the listing lacks keeps none, so its row shows the tokens alone.
	protected askWindows(): void {
		const { shown, view } = this.session;
		const refs = shown ? unaskedModels(view.agents, this.asked) : [];
		if (shown && refs.length > 0)
			void this.loadWindows(shown.dir, shown.runId, refs);
	}

	// The thinking row counts while the shown run has a model call in flight (ADR-125).
	protected tickThinking(): void {
		const thinking = this.session.view.thinkingSince !== undefined;
		this.transcripts.tick(this.shown && thinking && !this.showsComposer());
	}

	protected async loadWindows(dir: string, runId: string, refs: ModelRef[]) {
		const r = await this.daemon.models(dir, refs);
		if (!r.ok || this.shownRun.runId !== runId) return;
		this.windows = { ...this.windows, ...windowsOf(r.value.models) };
		this.update();
	}

	protected async allowShown(scope: AllowScope): Promise<string | undefined> {
		const shown = this.session.shown;
		if (!shown) return;
		const r = await this.daemon.allow(shown.dir, shown.runId, scope);
		if (!r.ok) return r.error.detail;
	}

	protected teamControls(): TeamControls {
		return {
			mode: this.mode,
			onMode: (mode) => {
				this.mode = mode;
				this.update();
			},
			markdown: this.markdown,
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
			onModel: (roleId, model) => void this.models.setModel(roleId, model),
			candidateModels: this.models.candidates,
			preferredModels: this.models.preferred,
			transcript: this.transcripts.state,
			waiting: {
				onApprove: () => void this.decide(APPROVE_RUN_COMMAND.id),
				onRevise: (feedback) =>
					void this.decide(REVISE_RUN_COMMAND.id, feedback),
				onResume: () => void this.decide(RESUME_RUN_COMMAND.id),
				onAllow: (scope) => this.allowShown(scope),
			},
		};
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				{this.showsComposer() ? (
					this.composer.render()
				) : (
					<BoardView
						model={this.session.model}
						controls={this.teamControls()}
					/>
				)}
			</div>
		);
	}
}
