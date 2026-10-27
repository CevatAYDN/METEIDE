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
	type WelcomeModel,
	type WelcomePrivacy,
	WelcomeView,
} from "../application/welcome-view.js";
import { activeRunsOf } from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { START_RUN_COMMAND } from "./board-contribution.js";
import { EndpointKeys } from "./endpoint-keys.js";
import { MetePanelWidget } from "./panel-widget.js";
import { SettingsForms } from "./settings-forms.js";
import "../../style/mete-welcome.css";

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
		this.forms = new SettingsForms(this.files, () => this.update());
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
		const r = await this.daemon.keys();
		this.model = r.ok
			? { kind: "keys", keys: r.value }
			: { kind: "failed", failure: r.error };
		this.update();
		await this.loadFolder();
	}

	// The global file's path comes from the folder's daemon, so privacy waits for a folder (ADR-088).
	protected async loadFolder(): Promise<void> {
		const [root] = await this.workspace.roots;
		this.root = root?.resource;
		if (!root) return this.update();
		this.activeRuns = await this.folderRuns();
		const s = await this.daemon.settings(root.resource.path.fsPath());
		if (!s.ok) return this.update();
		this.globalFile = s.value.globalFile;
		await this.forms?.load(root.resource, s.value.globalFile);
		this.forms?.forms().privacy?.actions.onTarget("global");
	}

	protected async folderRuns(): Promise<number> {
		const [root] = await this.workspace.roots;
		if (!root) return 0;
		const r = await this.daemon.status(root.resource.path.fsPath());
		return r.ok ? activeRunsOf(r.value) : 0;
	}

	protected privacy(): WelcomePrivacy | undefined {
		if (!this.root) return { kind: "no_folder" };
		const form = this.forms?.forms().privacy;
		return (
			form && { kind: "form", ...form, canSaveGlobally: !!this.globalFile }
		);
	}

	protected start(): void {
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
						}}
					/>
				) : null}
			</div>
		);
	}
}
