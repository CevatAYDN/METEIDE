import { CommandService, MessageService } from "@theia/core";
import { Emitter } from "@theia/core/lib/common/event";
import { nls } from "@theia/core/lib/common/nls";
import { inject, injectable } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	type ChainContext,
	type ComposerOption,
	loadRoles,
	narrowedTo,
	optionsOf,
	preferOf,
	singleAgentModels,
	startOf,
} from "../application/composer.js";
import {
	type ComposerModel,
	ComposerView,
} from "../application/composer-view.js";
import { failureText } from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import {
	EDIT_TEAM_COMMAND,
	NEW_TEAM_COMMAND,
} from "./team-editor-contribution.js";

// The run composer (docs/13, Run composer; ADR-071) of the first open folder, shown by the Team panel
// while it shows no run (ADR-078): it asks the daemon for the templates and each one's estimate every
// time it is shown, so a new `.mete/teams/` file shows, and a started run takes the panel's place.

/** A run the composer started, in its folder. */
export type StartedRun = {
	readonly dir: string;
	readonly runId: string;
	readonly goal: string;
};

/** The METE run composer: its state and requests; the Team panel draws it. */
@injectable()
export class MeteRunComposer {
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MessageService) protected readonly messages!: MessageService;

	protected readonly changed = new Emitter<void>();
	/** Fires when the composer needs drawing again. */
	readonly onDidChange = this.changed.event;
	protected readonly startedRun = new Emitter<StartedRun>();
	/** Fires with a run the composer started. */
	readonly onDidStart = this.startedRun.event;

	protected model: ComposerModel = { kind: "loading" };
	protected dir: string | undefined;
	/** Every option, as the lists came; the shown ones narrow to the router's suggestions. */
	protected all: readonly ComposerOption[] = [];
	protected goal = "";
	protected selected = "choose";
	protected singleModel: string | undefined;
	protected roleModels: Record<string, Record<string, string>> = {};
	protected readonly chainCache = new Map<string, readonly string[]>();
	protected busy = false;
	protected error: string | undefined;
	protected pending: Promise<void> | undefined;

	// Coming back to the composer asks for the teams again (ADR-071), so a team saved meanwhile
	// shows; a refresh still loading or a start in flight is not asked twice.
	/** Asks again unless a start is in flight; the panel calls it whenever it shows the composer. */
	reopen(): Promise<void> {
		return this.busy ? Promise.resolve() : this.refresh();
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
		this.chainCache.clear();
		if (this.model.kind !== "ready") this.setModel({ kind: "loading" });
		const listed = await this.daemon.templates(this.dir);
		const raw = listed.ok ? listed.value.templates : [];
		const dir = this.dir;
		const ctx: ChainContext = {
			daemon: this.daemon,
			dir,
			cache: this.chainCache,
		};
		const [templates, singleModels, ...estimates] = await Promise.all([
			loadRoles(ctx, raw),
			singleAgentModels(ctx),
			...[...raw.map((t) => t.id), null].map((id) =>
				this.daemon.estimate(dir, id),
			),
		]);
		this.all = optionsOf(templates, estimates, singleModels);
		this.selected = this.all.some((o) => o.key === this.selected)
			? this.selected
			: "choose";
		this.setModel({ kind: "ready", options: this.all, unsure: false });
	}

	// Start sends the goal and the pick; an unsure router narrows the list in place (ADR-047), and a
	// started run takes the composer's place in the Team panel.
	protected async start(): Promise<void> {
		const option = this.options().find((o) => o.key === this.selected);
		const dir = this.dir;
		if (!dir || !option || this.busy || !this.goal.trim()) return;
		this.busy = true;
		this.error = undefined;
		this.changed.fire();
		const rolePrefs =
			typeof option.templateId === "string"
				? this.roleModels[option.key]
				: undefined;
		const prefer = preferOf(
			option.templateId,
			this.singleModel,
			rolePrefs,
			option.roles?.map((r) => r.id),
		);
		const r = await this.daemon.startRun(
			dir,
			startOf(this.goal, option, prefer),
		);
		this.busy = false;
		if (r.ok) return this.started(dir, r.value.runId);
		if (r.error.code === "choose_template") this.narrow(r.error.suggestions);
		else this.error = failureText(r.error);
		this.changed.fire();
	}

	protected options(): readonly ComposerOption[] {
		return this.model.kind === "ready" ? this.model.options : [];
	}

	protected narrow(suggestions: readonly string[] | undefined): void {
		const options = narrowedTo(suggestions ?? [], this.all);
		this.selected = options[0]?.key ?? "single";
		this.setModel({ kind: "ready", options, unsure: true });
	}

	protected started(dir: string, runId: string): void {
		const goal = this.goal;
		void this.messages.info(
			nls.localize("mete/run/started", "Run started: {0}", runId),
		);
		this.goal = "";
		this.selected = "choose";
		this.singleModel = undefined;
		this.roleModels = {};
		this.setModel({ kind: "ready", options: this.all, unsure: false });
		this.startedRun.fire({ dir, runId, goal });
	}

	protected setModel(model: ComposerModel): void {
		this.model = model;
		this.changed.fire();
	}

	/** The composer's screen. */
	render() {
		return (
			<ComposerView
				model={this.model}
				goal={this.goal}
				selected={this.selected}
				busy={this.busy}
				error={this.error}
				singleModel={this.singleModel}
				roleModels={this.selected ? this.roleModels[this.selected] : undefined}
				onGoal={(goal) => {
					this.goal = goal;
					this.changed.fire();
				}}
				onSelect={(key) => {
					this.selected = key;
					this.changed.fire();
				}}
				onSingleModel={(model) => {
					this.singleModel = model;
					this.changed.fire();
				}}
				onRoleModel={(roleId, model) => {
					const current = this.roleModels[this.selected] ?? {};
					this.roleModels = {
						...this.roleModels,
						[this.selected]: { ...current, [roleId]: model },
					};
					this.changed.fire();
				}}
				onStart={() => void this.start()}
				onEdit={(id) =>
					void this.commands.executeCommand(EDIT_TEAM_COMMAND.id, id)
				}
				onNewTeam={() => void this.commands.executeCommand(NEW_TEAM_COMMAND.id)}
			/>
		);
	}
}
