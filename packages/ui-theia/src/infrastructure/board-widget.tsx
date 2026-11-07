import type { AllowScope, MeteEvent, ModelRef } from "@mete/contracts";
import { CommandService, MessageService } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import URI from "@theia/core/lib/common/uri";
import type { Message } from "@theia/core/shared/@lumino/messaging";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { REMOVE_RUN_COMMAND } from "../application/approval-commands.js";
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
import type { RunFacts } from "../application/run-hero.js";
import { failureText, plain } from "../application/status-text.js";
import { createTaskControlPanel } from "../application/task-control-panel.js";
import { roleNames, teamName } from "../application/team-draft.js";
import { createTranscriptSession } from "../application/transcript-session.js";
import { isPage } from "../application/worktree-files.js";
import { waitsForQuota } from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { boardContextListeners, createBoardContext } from "./board-context.js";
import { boardScenes, boardWaiting } from "./board-presentations.js";
import { MeteEditorContext } from "./editor-context-service.js";
import { focusComposer } from "./focus-composer.js";
import { MetePanelWidget } from "./panel-widget.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";
import { MeteRunComposer } from "./run-composer.js";
import { MeteShownRun } from "./shown-run.js";
import { showWorktreeFiles } from "./worktree-files.js";
import "../../style/mete-board.css";

@injectable()
export class MeteBoardWidget extends MetePanelWidget {
	static readonly ID = "mete.board";
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(MeteRunComposer) protected readonly composer!: MeteRunComposer;
	@inject(MeteEditorContext) protected readonly context?: MeteEditorContext;
	@inject(MeteShownRun) protected readonly shownRun!: MeteShownRun;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(FileService) protected readonly files!: FileService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	protected session: BoardSession = IDLE_BOARD;
	protected shown = true;
	protected mode: TeamMode = "board";
	protected restoring: string | undefined;
	protected names: Readonly<Record<string, string>> = {};
	protected windows: Readonly<Record<string, number>> = {};
	protected run: RunFacts = {};
	protected asked = new Set<string>();
	protected composing = true;
	protected focusWhenReady = false;
	protected models!: ModelSession;
	protected readonly tasks = createTaskControlPanel(
		() => this.daemon,
		() => this.session.shown,
		() => this.update(),
	);
	protected readonly transcripts = createTranscriptSession({
		fetch: (dir, runId) => this.daemon.transcript(dir, runId),
		onChange: () => this.update(),
	});
	protected readonly conversation = createBoardContext({
		context: () => this.context,
		daemon: () => this.daemon,
		shown: () => this.session.shown,
		disposed: () => this.isDisposed,
		leave: () => this.composer.leave(),
		currentDir: () => this.workspace.tryGetRoots()[0]?.resource.path.fsPath(),
		show: this.showRun.bind(this),
		remove: (runId) =>
			void this.commands.executeCommand(REMOVE_RUN_COMMAND.id, runId),
		onChange: () => this.update(),
	});

	@postConstruct()
	protected init(): void {
		this.conversation.selectInitial();
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
		this.watch();
		void this.composer.reopen();
		this.update();
	}

	protected watch(): void {
		this.toDispose.pushAll([
			...boardContextListeners(
				this.context,
				this.workspace,
				() => this.update(),
				() => void this.showComposer(),
			),
			this.themes.onDidColorThemeChange(() => this.update()),
			this.events.onDidReceive(({ workspaceDir, event }) => {
				this.tasks.session.onEvent(workspaceDir, event);
				this.setSession(receiveBoard(this.session, workspaceDir, event));
				this.transcripts.onEvent(event);
				const shown = this.session.shown;
				if (shown?.dir !== workspaceDir) return;
				if (event.type.startsWith("run."))
					void this.conversation.history.refresh();
				if (shown && event.runId === shown.runId)
					this.onShownEvent(shown.dir, shown.runId, event);
			}),
			this.composer.onDidChange(() => {
				this.update();
				this.focusComposer();
			}),
			this.composer.onDidStart((s) => {
				this.conversation.remember(s, s.capabilities);
				void this.showRun(s.dir, s.runId, s.goal);
			}),
			{ dispose: () => this.shownRun.set(undefined) },
			{ dispose: () => this.transcripts.dispose() },
			{ dispose: () => this.tasks.session.clear() },
			{ dispose: this.conversation.dispose },
		]);
	}

	protected onShownEvent(dir: string, runId: string, event: MeteEvent) {
		if (event.type === "run.created")
			this.models.setTemplate(event.payload.templateId);
		if (event.type === "run.removed") void this.showComposer();
		else if (event.type.startsWith("run.")) void this.loadRun(dir, runId);
	}

	/** Shows the run composer in place of the run. */
	showComposer(): Promise<void> {
		this.conversation.clear();
		this.conversation.selectInitial();
		this.tasks.session.clear();
		this.composing = true;
		this.shownRun.set(undefined);
		this.setSession(IDLE_BOARD);
		this.update();
		return this.composer.reopen();
	}

	async showRun(dir: string, runId: string, goal: string): Promise<void> {
		this.conversation.clear();
		this.composing = false;
		this.shownRun.set(runId);
		this.names = {};
		this.run = {};
		this.windows = {};
		this.asked = new Set();
		this.models.show(dir, runId);
		const shown = { dir, runId, goal };
		this.setSession(startBoard(shown));
		void this.tasks.session.show(dir, runId);
		this.transcripts.show(dir, runId);
		const r = await this.daemon.events(dir, runId);
		const created = r.ok
			? r.value.events.find((e) => e.type === "run.created")
			: undefined;
		if (created?.type === "run.created")
			this.models.setTemplate(created.payload.templateId);
		this.setSession(loadedBoard(this.session, shown, r));
		if (this.session.shown !== shown) return;
		if (!created?.payload.templateId)
			await this.conversation.history.show(shown);
		if (this.session.shown === shown && !created?.payload.templateId)
			this.conversation.selectRun(shown);
		void this.loadRun(dir, runId);
		if (created?.type === "run.created" && created.payload.templateId)
			void this.loadNames(dir, runId, created.payload.templateId);
	}

	protected async loadRun(dir: string, runId: string): Promise<void> {
		const r = await this.daemon.status(dir, runId);
		if (!r.ok || this.shownRun.runId !== runId) return;
		const run = r.value.find((x) => x.id === runId);
		if (!run) return;
		const q = waitsForQuota(run) ? await this.daemon.quota(dir) : undefined;
		if (this.shownRun.runId !== runId) return;
		const blocked = q?.ok
			? q.value.providers.filter((p) => p.state !== "ready")
			: [];
		this.run = { ...this.run, run, blocked };
		this.models.onRun(run, this.session.view.agents[0]?.roleId ?? "assistant");
		this.update();
	}

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

	protected decide(command: string, feedback?: string) {
		const runId = this.shownRun.runId;
		if (!runId) return Promise.resolve();
		return this.commands.executeCommand(command, runId, feedback);
	}

	protected override onActivateRequest(msg: Message): void {
		super.onActivateRequest(msg);
		if (!this.showsComposer()) return;
		this.focusWhenReady = true;
		void this.composer.reopen();
	}
	protected focusComposer(): void {
		if (!this.focusWhenReady || !this.composer.canFocusGoal()) return;
		focusComposer(
			{
				node: this.node,
				ready: () => this.showsComposer() && this.composer.canFocusGoal(),
				visible: () => this.isVisible,
			},
			() => {
				this.focusWhenReady = false;
			},
		);
	}
	protected showsComposer() {
		return this.composing || this.session.model.kind === "no_run";
	}

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

	protected async openReport(path: string): Promise<void> {
		const shown = this.session.shown;
		if (!shown) return;
		try {
			const uri = URI.fromFilePath(shown.dir).resolve(path);
			await open(this.openers, uri, isPage(path) ? { openFor: "preview" } : {});
		} catch (e) {
			void this.messages.warn(String(e));
		}
	}

	protected showFiles(
		worktree: string,
		changed?: readonly string[],
	): Promise<void> {
		const { files, quick, openers, messages } = this;
		const deps = { files, quick, openers, messages };
		return showWorktreeFiles(deps, worktree, changed);
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

	protected askWindows(): void {
		const { shown, view } = this.session;
		const refs = shown ? unaskedModels(view.agents, this.asked) : [];
		if (shown && refs.length > 0)
			void this.loadWindows(shown.dir, shown.runId, refs);
	}

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
			...boardScenes(
				this.shown,
				() => void this.commands.executeCommand(OPEN_QUOTA_COMMAND.id),
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
			modelFacts: this.models.picker,
			transcript: this.transcripts.state,
			...this.conversation.controls(),
			taskControls: this.tasks.render(),
			waiting: boardWaiting(
				this.decide.bind(this),
				this.allowShown.bind(this),
				this.showFiles.bind(this),
			),
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
