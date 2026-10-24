import { ThemeService } from "@theia/core/lib/browser/theming";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { panelRoot } from "../application/panel-root.js";
import { type QuotaModel, QuotaView } from "../application/quota-view.js";
import { MeteDaemonService } from "../domain/status-service.js";

// The Quota dashboard (docs/13; ADR-054) of the first open folder: it asks the daemon again when
// it opens, on Refresh and on every quota.* event of its folder (quota events of a call carry no
// run, so the folder decides).

/** The METE Quota dashboard in Theia's main area. */
@injectable()
export class MeteQuotaWidget extends ReactWidget {
	static readonly ID = "mete.quota.dashboard";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(ThemeService) protected readonly themes!: ThemeService;

	protected model: QuotaModel = { kind: "loading" };
	protected dir: string | undefined;

	// No state, so Theia's saved layout leaves the tab out and a restart does not reopen it (ADR-086).
	storeState(): undefined {
		return undefined;
	}

	restoreState(): void {}

	@postConstruct()
	protected init(): void {
		this.id = MeteQuotaWidget.ID;
		this.title.label = nls.localize("mete/quota/title", "Quota");
		this.title.caption = nls.localize(
			"mete/quota/caption",
			"METE: each provider's quota units",
		);
		this.title.iconClass = codicon("dashboard");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.toDispose.push(
			this.events.onDidReceive(({ workspaceDir, event }) => {
				if (workspaceDir === this.dir && event.type.startsWith("quota."))
					void this.refresh();
			}),
		);
		void this.refresh();
	}

	/** Asks the daemon of the first open folder for the quota pool's units. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		this.dir = root.resource.path.fsPath();
		const r = await this.daemon.quota(this.dir);
		this.setModel(
			r.ok
				? { kind: "units", units: r.value.units }
				: { kind: "failed", failure: r.error },
		);
	}

	protected setModel(model: QuotaModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<QuotaView model={this.model} onRefresh={() => void this.refresh()} />
			</div>
		);
	}
}
