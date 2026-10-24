import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
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
import { type ChangesModel, ChangesView } from "../application/changes-view.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { panelRoot } from "../application/panel-root.js";
import { failureText } from "../application/status-text.js";
import { type Changes, MeteDaemonService } from "../domain/status-service.js";

// The Changes view (docs/13; ADR-100) of the first open folder: it asks the daemon for the working
// tree when it opens, on Refresh, when a tool call of its folder completes while it is visible, and
// for one file's diff when a row is clicked.

/** The METE Changes view in Theia's main area. */
@injectable()
export class MeteChangesWidget extends ReactWidget {
	static readonly ID = "mete.changes";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(OpenerService) protected readonly openers!: OpenerService;

	protected model: ChangesModel = { kind: "loading" };
	protected dir: string | undefined;

	// No state, so Theia's saved layout leaves the tab out and a restart does not reopen it (ADR-086).
	storeState(): undefined {
		return undefined;
	}

	restoreState(): void {}

	@postConstruct()
	protected init(): void {
		this.id = MeteChangesWidget.ID;
		this.title.label = nls.localize("mete/changes/title", "Changes");
		this.title.caption = nls.localize(
			"mete/changes/caption",
			"METE: what changed in this folder",
		);
		this.title.iconClass = codicon("diff");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.toDispose.push(
			this.events.onDidReceive(({ workspaceDir, event }) => {
				if (
					workspaceDir === this.dir &&
					event.type === "agent.tool.completed" &&
					this.isVisible
				)
					void this.refresh();
			}),
		);
		void this.refresh();
	}

	/** Asks the daemon of the first open folder for its working tree. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		this.dir = root.resource.path.fsPath();
		const picked = this.model.kind === "files" ? this.model.picked : undefined;
		await this.load(picked);
	}

	// The list and the picked file's diff come from one request.
	protected async load(picked?: string): Promise<void> {
		if (!this.dir) return this.setModel({ kind: "no_folder" });
		const r = await this.daemon.changes(this.dir, picked);
		if (!r.ok)
			return this.setModel({ kind: "failed", message: failureText(r.error) });
		this.setModel(this.modelOf(r.value, picked));
	}

	/** Opens a changed file with Theia's default opener, the editor the app ships (ADR-102). */
	protected async openFile(path: string): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return;
		// shortcut: a file the handler cannot open leaves the panel as it was.
		await open(this.openers, root.resource.resolve(path)).catch(
			() => undefined,
		);
	}

	// A picked file that the list no longer holds drops its diff, so no stale one is shown.
	protected modelOf(changes: Changes, picked?: string): ChangesModel {
		if (!changes.vcs) return { kind: "no_git" };
		const keep = changes.files.some((f) => f.path === picked)
			? picked
			: undefined;
		return {
			kind: "files",
			changes,
			...(keep === undefined ? {} : { picked: keep }),
		};
	}

	protected setModel(model: ChangesModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<ChangesView
					model={this.model}
					controls={{
						onPick: (path) => void this.load(path),
						onRefresh: () => void this.refresh(),
						onOpen: (path) => void this.openFile(path),
					}}
				/>
			</div>
		);
	}
}
