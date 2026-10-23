import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { HomeView } from "../application/home-view.js";
import { type HomeModel, homeModel } from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";

// The Home panel (docs/13, Home): recent runs of the first open folder, asked of its daemon.
// shortcut: a snapshot taken when the panel opens or is refreshed; it follows the runs live once
// the daemon's mete/event notifications reach the frontend.

/** The METE Home view in Theia's side bar. */
@injectable()
export class MeteHomeWidget extends ReactWidget {
	static readonly ID = "mete.home";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

	protected model: HomeModel = { kind: "loading" };

	@postConstruct()
	protected init(): void {
		this.id = MeteHomeWidget.ID;
		this.title.label = nls.localize("mete/home/title", "METE");
		this.title.caption = nls.localize("mete/home/caption", "METE: recent runs");
		this.title.iconClass = codicon("home");
		this.title.closable = true;
		void this.refresh();
	}

	/** Asks the daemon of the first open folder again and draws the answer. */
	async refresh(): Promise<void> {
		// The roots promise waits for the workspace to load; tryGetRoots is empty until then.
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		this.setModel({ kind: "loading" });
		const reply = await this.daemon.status(root.resource.path.fsPath());
		this.setModel(homeModel(reply, new Date().toISOString()));
	}

	protected setModel(model: HomeModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<HomeView model={this.model} onRefresh={() => void this.refresh()} />
		);
	}
}
