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
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { panelRoot } from "../application/panel-root.js";
import {
	type SettingsModel,
	SettingsView,
} from "../application/settings-view.js";
import { MeteDaemonService } from "../domain/status-service.js";

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

	protected model: SettingsModel = { kind: "loading" };

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
		void this.refresh();
	}

	/** Asks the daemon of the first open folder what configuration it loaded. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		const r = await this.daemon.settings(root.resource.path.fsPath());
		this.setModel(
			r.ok
				? { kind: "settings", settings: r.value }
				: { kind: "failed", failure: r.error },
		);
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
					actions={{
						onCommand: (id) => void this.commands.executeCommand(id),
						onOpen: (file) => void open(this.openers, URI.fromFilePath(file)),
						onRefresh: () => void this.refresh(),
					}}
				/>
			</div>
		);
	}
}
