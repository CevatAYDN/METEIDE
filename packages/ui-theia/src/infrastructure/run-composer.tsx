import type { RunPrefer } from "@mete/contracts";
import { CommandService, MessageService } from "@theia/core";
import { Emitter } from "@theia/core/lib/common/event";
import { inject, injectable } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	type ChainContext,
	type ComposerOption,
	loadRoles,
	narrowedTo,
	optionsOf,
	type PickerFacts,
	pickerFacts,
	preferOf,
	settledChoice,
	singleAgentModels,
	startOf,
	withEstimate,
} from "../application/composer.js";
import {
	type ComposerModel,
	ComposerView,
} from "../application/composer-view.js";
import { failureText, startedText } from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import {
	EDIT_TEAM_COMMAND,
	NEW_TEAM_COMMAND,
} from "./team-editor-contribution.js";
import "../../style/mete-composer.css";
import "../../style/mete-picker.css";

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
	/** The folder's uncommitted changes, which a team's worktree does not hold (ADR-156). */
	protected uncommitted = 0;
	/** Counts the estimates asked again, so an answer that came after a newer ask is dropped. */
	protected estimateAsked = 0;
	protected roleModels: Record<string, Record<string, string>> = {};
	protected readonly chainCache = new Map<string, readonly string[]>();
	/** The model picker's facts and states, asked once the chains came (ADR-161 (5)). */
	protected picker: PickerFacts | undefined;
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
		const [templates, singleModels, changes, ...estimates] = await Promise.all([
			loadRoles(ctx, raw),
			singleAgentModels(ctx),
			this.daemon.changes(dir),
			...[...raw.map((t) => t.id), null].map((id) =>
				this.daemon.estimate(dir, id),
			),
		]);
		this.all = optionsOf(templates, estimates, singleModels);
		this.uncommitted = changes.ok ? changes.value.files.length : 0;
		this.selected = this.all.some((o) => o.key === this.selected)
			? this.selected
			: "choose";
		this.setModel({ kind: "ready", options: this.all, unsure: false });
		// The list shows before the facts, which only add words to its rows.
		const chains = [...this.chainCache.values()].flat();
		this.picker = await pickerFacts(this.daemon, dir, chains);
		this.changed.fire();
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
		const r = await this.daemon.startRun(
			dir,
			startOf(this.goal, option, this.preferFor(option)),
		);
		this.busy = false;
		if (r.ok) return this.started(dir, r.value.runId);
		if (r.error.code === "choose_template") this.narrow(r.error.suggestions);
		else this.error = failureText(r.error);
		this.changed.fire();
	}

	// The model choice of an option: the single agent's, or its roles' (ADR-122).
	protected preferFor(option: ComposerOption): RunPrefer | undefined {
		const rolePrefs =
			typeof option.templateId === "string"
				? this.roleModels[option.key]
				: undefined;
		return preferOf(
			option.templateId,
			this.singleModel,
			rolePrefs,
			option.roles?.map((r) => r.id),
		);
	}

	// The chosen option's estimate asked again with its model choice (ADR-155); the last ask wins.
	protected async reestimate(): Promise<void> {
		const option = this.options().find((o) => o.key === this.selected);
		const dir = this.dir;
		if (!dir || option?.templateId === undefined) return;
		const asked = ++this.estimateAsked;
		const prefer = this.preferFor(option);
		const reply = await this.daemon.estimate(dir, option.templateId, prefer);
		if (asked !== this.estimateAsked || this.model.kind !== "ready") return;
		this.all = withEstimate(this.all, option.key, reply);
		const options = withEstimate(this.model.options, option.key, reply);
		this.setModel({ ...this.model, options });
	}

	// A typed choice asks again once it is a listed model or cleared, so typing sends nothing.
	protected chose(model: string, listed: readonly string[] | undefined) {
		this.changed.fire();
		if (settledChoice(model, listed)) void this.reestimate();
	}

	protected chosen(): ComposerOption | undefined {
		return this.options().find((o) => o.key === this.selected);
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
		void this.messages.info(startedText(goal));
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
				uncommitted={this.uncommitted}
				picker={this.picker}
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
					this.chose(model, this.chosen()?.models);
				}}
				onRoleModel={(roleId, model) => {
					const current = this.roleModels[this.selected] ?? {};
					this.roleModels = {
						...this.roleModels,
						[this.selected]: { ...current, [roleId]: model },
					};
					const role = this.chosen()?.roles?.find((r) => r.id === roleId);
					this.chose(model, role?.models);
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
