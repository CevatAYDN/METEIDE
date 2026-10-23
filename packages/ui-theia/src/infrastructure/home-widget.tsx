import { CommandService } from "@theia/core";
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
import {
	APPROVE_RUN_COMMAND,
	RESUME_RUN_COMMAND,
	REVISE_RUN_COMMAND,
} from "../application/approval-commands.js";
// The design system of docs/13 on every METE panel (ADR-069); the bundle inlines its font.
import "../../style/mete.css";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import {
	type HomeAction,
	HomeView,
	type Workspace,
} from "../application/home-view.js";
import { SET_KEY_COMMAND } from "../application/key-command.js";
import { panelRoot } from "../application/panel-root.js";
import {
	type HomeModel,
	homeModel,
	waitingCount,
} from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { OPEN_ARTIFACT_COMMAND } from "./artifact-command.js";
import { OPEN_BOARD_COMMAND } from "./board-contribution.js";
import { START_RUN_COMMAND } from "./composer-contribution.js";
import { MeteInboxBadge } from "./inbox-badge.js";

// The Home panel (docs/13, Home): recent runs of the first open folder, asked of its daemon.
// It asks again when the panel opens, on Refresh and on every run.* event of its folder.

/** The METE Home view in Theia's side bar. */
@injectable()
export class MeteHomeWidget extends ReactWidget {
	static readonly ID = "mete.home";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MeteInboxBadge) protected readonly badge!: MeteInboxBadge;
	@inject(ThemeService) protected readonly themes!: ThemeService;

	protected model: HomeModel = { kind: "loading" };
	protected workspaces: readonly Workspace[] = [];
	/** The folder the shown runs belong to. */
	protected dir: string | undefined;

	@postConstruct()
	protected init(): void {
		this.id = MeteHomeWidget.ID;
		this.title.label = nls.localize("mete/home/title", "METE");
		this.title.caption = nls.localize("mete/home/caption", "METE: recent runs");
		this.title.iconClass = codicon("home");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		// A run of the shown folder changed: ask again; run events are few, so no debounce.
		this.toDispose.push(
			this.events.onDidReceive(({ workspaceDir, event }) => {
				if (workspaceDir === this.dir && event.type.startsWith("run."))
					void this.refresh();
			}),
		);
		// A key set from the palette or from the button restarts the daemon: ask again either way.
		this.toDispose.push(
			this.commands.onDidExecuteCommand(({ commandId }) => {
				if (commandId === SET_KEY_COMMAND.id) void this.refresh();
			}),
		);
		void this.refresh();
	}

	// The folders opened before, newest first, as Theia remembers them (docs/13, Home: Workspaces).
	protected async loadWorkspaces(current: string | undefined) {
		const recent = await this.workspace.recentWorkspaces();
		this.workspaces = recent.map((uri) => {
			const path = new URI(uri).path;
			return {
				uri,
				name: path.base,
				path: path.fsPath(),
				current: uri === current,
			};
		});
		this.update();
	}

	/** Asks the daemon of the first open folder again and draws the answer. */
	async refresh(): Promise<void> {
		// The roots promise waits for the workspace to load; tryGetRoots is empty until then.
		const [root] = await this.workspace.roots;
		void this.loadWorkspaces(root?.resource.toString());
		if (!root) return this.setModel({ kind: "no_folder" });
		this.dir = root.resource.path.fsPath();
		if (this.model.kind !== "runs") this.setModel({ kind: "loading" });
		const reply = await this.daemon.status(this.dir);
		const at = new Date().toISOString();
		// The runs draw at once; the quota states can wait on a first model listing, so they follow.
		this.setModel(homeModel(reply, at));
		if (!reply.ok) return;
		this.setModel(homeModel(reply, at, await this.providers(this.dir)));
	}

	// The quota summary and the lines under a quota pause add to the runs, which show without them;
	// a failed ask leaves them out, and METE: Quota says why it failed.
	protected async providers(dir: string) {
		const r = await this.daemon.quota(dir);
		return r.ok ? r.value.providers : [];
	}

	// The inbox's buttons and a run's goal run the palette commands, so the keyboard and the mouse
	// share one path.
	protected act(action: HomeAction, runId: string) {
		const id = {
			approve: APPROVE_RUN_COMMAND.id,
			revise: REVISE_RUN_COMMAND.id,
			resume: RESUME_RUN_COMMAND.id,
			open: OPEN_BOARD_COMMAND.id,
			artifact: OPEN_ARTIFACT_COMMAND.id,
		}[action];
		return this.commands.executeCommand(id, runId);
	}

	// The daemon restarts with the new key, so the panel asks again once the command is done.
	protected setKey() {
		return this.commands.executeCommand(SET_KEY_COMMAND.id);
	}

	protected setModel(model: HomeModel): void {
		this.model = model;
		this.badge.set(waitingCount(model));
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<HomeView
					model={this.model}
					onRefresh={() => void this.refresh()}
					onAct={(action, runId) => void this.act(action, runId)}
					onSetKey={() => void this.setKey()}
					onStart={() =>
						void this.commands.executeCommand(START_RUN_COMMAND.id)
					}
					workspaces={this.workspaces}
					onOpenWorkspace={(uri) => this.workspace.open(new URI(uri))}
				/>
			</div>
		);
	}
}
