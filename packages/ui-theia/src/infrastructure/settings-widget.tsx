import { CommandService } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { panelRoot } from "../application/panel-root.js";
import {
	type ApplyState,
	type SettingsModel,
	SettingsView,
} from "../application/settings-view.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { SettingsForms } from "./settings-forms.js";

// The read-only Settings screen (docs/13; ADR-081) of the first open folder: it asks the daemon
// what it loaded when it opens and on Refresh; a file opens in Theia's editor.

/** The METE Settings screen in Theia's main area. */
@injectable()
export class MeteSettingsWidget extends ReactWidget {
	static readonly ID = "mete.settings";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(FileService) protected readonly files!: FileService;

	protected model: SettingsModel = { kind: "loading" };
	protected forms: SettingsForms | undefined;
	protected apply: ApplyState = { busy: false, activeRuns: 0 };

	@postConstruct()
	protected init(): void {
		this.id = MeteSettingsWidget.ID;
		this.title.label = nls.localize("mete/settings/title", "Settings");
		this.title.caption = nls.localize(
			"mete/settings/caption",
			"METE: the configuration it loaded",
		);
		this.title.iconClass = codicon("settings-gear");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.forms = new SettingsForms(this.files, () => this.update());
		void this.refresh();
	}

	/** Asks the daemon of the first open folder what configuration it loaded. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		const dir = root.resource.path.fsPath();
		this.apply = { ...this.apply, activeRuns: await this.activeRuns(dir) };
		const r = await this.daemon.settings(dir);
		this.setModel(
			r.ok
				? { kind: "settings", settings: r.value }
				: { kind: "failed", failure: r.error },
		);
		// The forms read their files from disk, not the loaded values (ADR-082).
		if (r.ok) await this.forms?.load(root.resource, r.value.globalFile);
	}

	// Runs a restart would pause (ADR-083): queued or running ones; none when the status fails.
	protected async activeRuns(dir: string): Promise<number> {
		const r = await this.daemon.status(dir);
		return r.ok
			? r.value.filter(
					(run) => run.status === "running" || run.status === "queued",
				).length
			: 0;
	}

	// Apply now (ADR-083): checks the runs again, restarts the daemon, and shows what it loaded.
	protected async applyNow(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root || this.apply.busy) return;
		const activeRuns = await this.activeRuns(root.resource.path.fsPath());
		this.apply = { busy: activeRuns === 0, activeRuns };
		this.update();
		if (activeRuns > 0) return;
		await this.daemon.restart();
		this.apply = { busy: false, activeRuns: 0 };
		await this.refresh();
	}

	protected setModel(model: SettingsModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<SettingsView
					model={this.model}
					forms={this.forms?.forms() ?? {}}
					apply={this.apply}
					actions={{
						onApply: () => void this.applyNow(),
						onCommand: (id) => void this.commands.executeCommand(id),
						onOpen: (file) => void open(this.openers, URI.fromFilePath(file)),
						onRefresh: () => void this.refresh(),
					}}
				/>
			</div>
		);
	}
}
