import type { ProviderState } from "@mete/contracts";
import { CommandService } from "@theia/core";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { WindowService } from "@theia/core/lib/browser/window/window-service";
import { nls } from "@theia/core/lib/common/nls";
import type URI from "@theia/core/lib/common/uri";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { panelRoot } from "../application/panel-root.js";
import {
	needsWelcome,
	type WelcomeModel,
	type WelcomePrivacy,
	WelcomeView,
} from "../application/welcome-view.js";
import { activeRunsOf } from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { START_RUN_COMMAND } from "./board-contribution.js";
import { EndpointKeys } from "./endpoint-keys.js";
import { MetePanelWidget } from "./panel-widget.js";
import { SHOW_SETTINGS_COMMAND } from "./settings-contribution.js";
import { SettingsForms } from "./settings-forms.js";
import "../../style/mete-welcome.css";
import "../../style/mete-welcome-health.css";

// The Welcome screen (docs/13 Onboarding wizard; ADR-088) in Theia's main area: the providers of
// `mete key list` with their key fields, and the privacy form once a folder is open.

const LANGUAGE_COMMAND = "workbench.action.configureLanguage";

/** The METE Welcome screen in Theia's main area. */
@injectable()
export class MeteWelcomeWidget extends MetePanelWidget {
	static readonly ID = "mete.welcome";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(FileService) protected readonly files!: FileService;
	@inject(WindowService) protected readonly windows!: WindowService;

	protected model: WelcomeModel = { kind: "loading" };
	protected keys: EndpointKeys | undefined;
	protected forms: SettingsForms | undefined;
	protected root: URI | undefined;
	protected globalFile: string | undefined;
	protected activeRuns = 0;
	protected states: readonly ProviderState[] | undefined;
	protected refreshRevision = 0;

	// No state, so a restored layout never brings it back by itself (ADR-086, ADR-088).
	storeState(): undefined {
		return undefined;
	}

	restoreState(): void {}

	@postConstruct()
	protected init(): void {
		this.id = MeteWelcomeWidget.ID;
		this.title.label = nls.localize("mete/welcome/open", "Welcome");
		this.title.caption = nls.localize(
			"mete/welcome/caption",
			"METE: keys, privacy and web search to start with",
		);
		this.title.iconClass = codicon("rocket");
		this.title.closable = true;
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.toDispose.push(
			this.workspace.onWorkspaceChanged(() => void this.refresh()),
		);
		this.keys = new EndpointKeys({
			setKey: (id, key) => this.daemon.setKey(id, key),
			activeRuns: () => this.folderRuns(),
			onSaved: () => void this.refresh(),
			onChange: () => this.update(),
			// The rows are built-in providers, so a key is set under the provider's own id.
			idOf: (id) => id,
		});
		void this.refresh();
	}

	/** Reads the providers' key state, and the privacy form of the open folder's global file. */
	async refresh(): Promise<void> {
		const revision = ++this.refreshRevision;
		this.forms = undefined;
		this.states = undefined;
		this.root = undefined;
		this.globalFile = undefined;
		this.update();
		const [root] = await this.workspace.roots;
		const current = () => this.current(revision, root?.resource);
		if (!current()) return;
		const r = await this.daemon.keys();
		if (!current()) return;
		this.root = root?.resource;
		this.model = r.ok
			? { kind: "keys", keys: r.value }
			: { kind: "failed", failure: r.error };
		this.update();
		if (root) await this.loadFolder(root.resource, current);
	}

	protected current(revision: number, root: URI | undefined): boolean {
		return (
			!this.isDisposed &&
			revision === this.refreshRevision &&
			root?.toString() === this.workspace.tryGetRoots()[0]?.resource.toString()
		);
	}

	// The global file's path comes from the folder's daemon, so privacy waits for a folder (ADR-088).
	protected async loadFolder(root: URI, current: () => boolean): Promise<void> {
		const dir = root.path.fsPath();
		const runs = await this.daemon.status(dir);
		if (!current()) return;
		this.activeRuns = runs.ok ? activeRunsOf(runs.value) : 0;
		const s = await this.daemon.settings(dir);
		if (!current()) return;
		if (!s.ok) return this.update();
		// Each refresh owns its forms; an older load cannot retarget the current instance.
		const forms = new SettingsForms(this.files, () => {
			if (current()) this.update();
		});
		await forms.load(root, s.value.globalFile);
		if (!current()) return;
		await forms.retargetAll("global");
		if (!current()) return;
		this.forms = forms;
		this.globalFile = s.value.globalFile;
		this.update();
		await this.loadStates(dir, current);
	}

	// The states wait on the daemon's first model listing, so they follow the keys and the privacy form.
	protected async loadStates(
		dir: string,
		current: () => boolean,
	): Promise<void> {
		const r = await this.daemon.quota(dir);
		if (!current()) return;
		this.states = r.ok ? r.value.providers : undefined;
		this.update();
	}

	protected async folderRuns(): Promise<number> {
		const [root] = await this.workspace.roots;
		if (!root) return 0;
		const r = await this.daemon.status(root.resource.path.fsPath());
		return r.ok ? activeRunsOf(r.value) : 0;
	}

	protected privacy(): WelcomePrivacy | undefined {
		if (!this.workspace.tryGetRoots()[0]) return { kind: "no_folder" };
		const { forms, root, refreshRevision } = this;
		const current = () =>
			this.forms === forms && this.current(refreshRevision, root);
		const form = forms?.forms().privacy;
		if (!form || !current()) return undefined;
		return {
			kind: "form",
			...form,
			canSaveGlobally: !!this.globalFile,
			actions: {
				onField: (key, value) => {
					if (current()) form.actions.onField(key, value);
				},
				onTarget: (target) => {
					if (current()) form.actions.onTarget(target);
				},
				onSave: () => {
					if (current()) form.actions.onSave();
				},
				onClear: () => {
					if (current()) form.actions.onClear();
				},
			},
		};
	}

	protected start(): void {
		if (
			!this.workspace.tryGetRoots()[0] ||
			this.model.kind !== "keys" ||
			needsWelcome(this.model.keys)
		)
			return;
		void this.commands.executeCommand(START_RUN_COMMAND.id);
		this.close();
	}

	protected override render() {
		const keys = this.keys;
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				{keys ? (
					<WelcomeView
						model={this.model}
						workspaceOpen={!!this.workspace.tryGetRoots()[0]}
						states={
							this.current(this.refreshRevision, this.root)
								? this.states
								: undefined
						}
						keys={{
							stateOf: (id) => keys.stateOf(id),
							onType: (id, key) => keys.type(id, key),
							onSet: (id) => void keys.set(id),
							activeRuns: this.activeRuns,
						}}
						privacy={this.privacy()}
						actions={{
							onLanguage: () =>
								void this.commands.executeCommand(LANGUAGE_COMMAND),
							onKeyPage: (url) =>
								this.windows.openNewWindow(url, { external: true }),
							onStart: () => this.start(),
							onCheck: () => void this.refresh(),
							onSettings: () =>
								void this.commands.executeCommand(SHOW_SETTINGS_COMMAND.id),
						}}
					/>
				) : null}
			</div>
		);
	}
}
