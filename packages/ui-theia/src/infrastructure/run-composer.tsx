import type { ConversationCapability, RunPrefer } from "@mete/contracts";
import { CommandService } from "@theia/core";
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
	withEstimate,
} from "../application/composer.js";
import {
	type ComposerModel,
	ComposerView,
} from "../application/composer-view.js";
import { contextScope } from "../application/context-drafts.js";
import {
	contextStartFailure,
	type StartedRun,
	sendInitialDraft,
	startComposerMessage,
} from "../application/context-start.js";
import { ConversationTools } from "../application/conversation-tools.js";
import {
	initialMessage,
	initialSettings,
	retireInitialRequest,
} from "../application/initial-context-receipt.js";
import { createSendIntent } from "../application/send-intent.js";
import { failureText } from "../application/status-text.js";
import {
	type DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";
import { composerContext } from "./composer-context.js";
import { MeteEditorContext } from "./editor-context-service.js";
import {
	EDIT_TEAM_COMMAND,
	NEW_TEAM_COMMAND,
} from "./team-editor-contribution.js";
import "../../style/mete-composer.css";
import "../../style/mete-picker.css";

// The Team panel hosts this composer (docs/13; ADR-071/078); reopening reloads teams and estimates.
export type { StartedRun } from "../application/context-start.js";
/** The METE run composer: its state and requests; the Team panel draws it. */
@injectable()
export class MeteRunComposer {
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MeteEditorContext) protected readonly context?: MeteEditorContext;

	protected readonly changed = new Emitter<void>();
	/** Fires when the composer needs drawing again. */
	readonly onDidChange = this.changed.event;
	protected readonly startedRun = new Emitter<StartedRun>();
	/** Fires with a run the composer started. */
	readonly onDidStart = this.startedRun.event;

	protected model: ComposerModel = { kind: "loading" };
	protected dir: string | undefined;
	protected all: readonly ComposerOption[] = [];
	protected goal = "";
	protected selected = "single";
	protected singleModel: string | undefined;
	protected capabilities: readonly ConversationCapability[] = [];
	protected uncommitted: number | undefined = 0;
	protected estimateAsked = 0;
	protected roleModels: Record<string, Record<string, string>> = {};
	protected readonly chainCache = new Map<string, readonly string[]>();
	protected picker: PickerFacts | undefined;
	protected busy = false;
	protected error: string | undefined;
	protected ready = false;
	protected loadError: string | undefined;
	protected pending: Promise<void> | undefined;
	protected readonly localIntents = createSendIntent();
	protected get intents() {
		return this.context?.drafts.intents ?? this.localIntents;
	}
	protected selectionVersion = 0;

	/** Retires navigation authority when another run takes the panel. */
	leave(): void {
		this.selectionVersion++;
	}

	protected edited(): void {
		retireInitialRequest(this.context?.drafts, this.intents, this.dir);
		this.selectionVersion++;
	}

	/** Whether the goal field exists and can receive focus. */
	canFocusGoal(): boolean {
		return this.ready && this.current();
	}

	/** Asks again unless a start is in flight; the panel calls it whenever it shows the composer. */
	reopen(): Promise<void> {
		return this.busy ? Promise.resolve() : this.refresh();
	}

	/** Asks the daemon of the first open folder for its templates and their estimates. */
	refresh(): Promise<void> {
		// The command and the tab's activation may both ask at once: they share one round of requests.
		this.pending ??= this.load().finally(() => {
			this.pending = undefined;
			if (!this.current()) return this.refresh();
		});
		return this.pending;
	}

	protected current(dir = this.dir, version = this.selectionVersion): boolean {
		return (
			this.workspace.tryGetRoots()[0]?.resource.path.fsPath() === dir &&
			dir === this.dir &&
			version === this.selectionVersion
		);
	}
	protected async load(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) {
			this.dir = undefined;
			this.ready = false;
			return this.setModel({ kind: "no_folder" });
		}
		const dir = root.resource.path.fsPath();
		this.openFolder(dir);
		const failures: DaemonFailure[] = [];
		const listed = await this.daemon.templates(dir);
		if (!this.current(dir)) return;
		if (!listed.ok) failures.push(listed.error);
		const raw = listed.ok ? listed.value.templates : [];
		const ctx: ChainContext = {
			daemon: this.daemon,
			dir,
			cache: this.chainCache,
			failed: (why) => failures.push(why),
		};
		const [templates, singleModels, changes, ...estimates] = await Promise.all([
			loadRoles(ctx, raw),
			singleAgentModels(ctx),
			this.daemon.changes(dir),
			...[...raw.map((t) => t.id), null].map((id) =>
				this.daemon.estimate(dir, id),
			),
		]);
		if (!this.current(dir)) return;
		this.all = optionsOf(templates, estimates, singleModels);
		if (!changes.ok) failures.push(changes.error);
		this.uncommitted = changes.ok ? changes.value.files.length : undefined;
		const [first] = failures;
		this.loadError = first ? failureText(first) : undefined;
		this.selected = this.all.some((o) => o.key === this.selected)
			? this.selected
			: "choose";
		this.setModel({ kind: "ready", options: this.all, unsure: false });
		this.ready = true;
		await this.loadPicker(dir);
	}
	protected async loadPicker(dir: string): Promise<void> {
		const chains = [...this.chainCache.values()].flat();
		const picker = await pickerFacts(this.daemon, dir, chains);
		if (!this.current(dir)) return;
		this.picker = picker;
		this.changed.fire();
	}
	protected openFolder(dir: string): void {
		if (this.dir !== dir) {
			const restored = initialSettings(this.context?.drafts, dir);
			this.selected = "single";
			this.singleModel = restored.singleModel;
			this.capabilities = restored.capabilities;
		}
		this.dir = dir;
		if (this.context)
			this.goal = this.context.drafts.read(contextScope(dir)).message;
		this.chainCache.clear();
		if (this.model.kind !== "ready") this.setModel({ kind: "loading" });
		this.ready = false;
	}
	protected async start(
		version = this.selectionVersion,
		dir = this.dir,
	): Promise<void> {
		const option = this.options().find((o) => o.key === this.selected);
		const goal = initialMessage(this.context?.drafts, dir, this.goal).trim();
		if (!dir || !option || this.busy || !goal || !this.current(dir, version))
			return;
		const failure = contextStartFailure(
			this.context?.drafts,
			dir,
			option.templateId,
		);
		if (failure) {
			this.error = failure;
			this.changed.fire();
			return;
		}
		this.busy = true;
		this.error = undefined;
		this.changed.fire();
		const r = await sendInitialDraft({
			drafts: this.context?.drafts,
			dir,
			send: () => this.startSelected(dir, option),
		});
		this.busy = false;
		if (r?.ok) this.intents.clear(dir);
		this.changed.fire();
		if (!r) return;
		const [root] = await this.workspace.roots;
		if (root?.resource.path.fsPath() !== dir) return this.refresh();
		if (version !== this.selectionVersion) return;
		if (r.ok) return this.started(dir, r.value.runId);
		if (r.error.code === "choose_template") this.narrow(r.error.suggestions);
		else this.error = failureText(r.error);
		this.changed.fire();
	}
	protected startSelected(dir: string, option: ComposerOption) {
		return startComposerMessage({
			daemon: this.daemon,
			dir,
			option,
			goal: initialMessage(this.context?.drafts, dir, this.goal),
			prefer: this.preferFor(option),
			capabilities: this.capabilities,
			intents: this.intents,
			drafts: this.context?.drafts,
		});
	}

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
		this.intents.clear(dir);
		const goal = this.goal;
		const capabilities =
			this.selected === "single" ? this.capabilities : undefined;
		this.goal = "";
		this.selected = "single";
		this.singleModel = undefined;
		this.capabilities = [];
		this.roleModels = {};
		this.setModel({ kind: "ready", options: this.all, unsure: false });
		this.startedRun.fire({ dir, runId, goal, capabilities });
	}

	protected setModel(model: ComposerModel): void {
		this.model = model;
		this.changed.fire();
	}

	/** The composer's screen. */
	protected renderTools() {
		const busy =
			this.busy ||
			!!(this.dir && this.context?.drafts.read(contextScope(this.dir)).busy);
		return this.selected === "single" ? (
			<ConversationTools
				capabilities={this.capabilities}
				disabled={busy}
				onChange={(selection) => {
					if (busy) return;
					this.edited();
					this.capabilities = selection;
					this.changed.fire();
				}}
			/>
		) : undefined;
	}
	render() {
		const { dir, selectionVersion } = this;
		const { current, scope, preparing, goal } = composerContext(
			this.workspace,
			this.dir,
			this.context,
			this.goal,
		);
		return (
			<ComposerView
				model={current ? this.model : { kind: "loading" }}
				goal={goal}
				selected={this.selected}
				busy={this.busy || !!preparing}
				preparing={!!preparing && !this.busy}
				attachments={
					current && scope
						? this.context?.render(
								scope,
								this.busy || this.selected !== "single",
							)
						: undefined
				}
				error={this.error ?? this.loadError}
				singleModel={this.singleModel}
				tools={this.renderTools()}
				uncommitted={this.uncommitted}
				picker={this.picker}
				roleModels={this.selected ? this.roleModels[this.selected] : undefined}
				{...this.draftHandlers(!!preparing, scope)}
				onStart={() => void this.start(selectionVersion, dir)}
				onOpenFolder={() =>
					void this.commands.executeCommand("workspace:openFolder")
				}
				onEdit={(id) =>
					void this.commands.executeCommand(EDIT_TEAM_COMMAND.id, id)
				}
				onNewTeam={() => void this.commands.executeCommand(NEW_TEAM_COMMAND.id)}
			/>
		);
	}

	protected draftHandlers(preparing: boolean, scope?: string) {
		return {
			onGoal: (goal: string) => {
				if (this.busy || preparing) return;
				if (goal !== this.goal) this.edited();
				this.goal = goal;
				if (scope) this.context?.drafts.message(scope, goal);
				this.changed.fire();
			},
			onSelect: (key: string) => {
				if (this.busy || preparing) return;
				if (key !== this.selected) this.edited();
				this.selected = key;
				this.context?.select(key === "single" ? this.dir : undefined);
				this.changed.fire();
			},
			onSingleModel: (model: string) => {
				if (this.busy || preparing) return;
				if (model !== this.singleModel) this.edited();
				this.singleModel = model;
				this.chose(model, this.chosen()?.models);
			},
			onRoleModel: (roleId: string, model: string) => {
				if (this.busy || preparing) return;
				const current = this.roleModels[this.selected] ?? {};
				this.roleModels = {
					...this.roleModels,
					[this.selected]: { ...current, [roleId]: model },
				};
				const role = this.chosen()?.roles?.find((r) => r.id === roleId);
				this.chose(model, role?.models);
			},
		};
	}
}
