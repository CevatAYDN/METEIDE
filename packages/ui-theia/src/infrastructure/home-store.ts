import { CommandService } from "@theia/core";
import { Emitter } from "@theia/core/lib/common/event";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileDialogService } from "@theia/filesystem/lib/browser/file-dialog/file-dialog-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	APPROVE_RUN_COMMAND,
	RESUME_RUN_COMMAND,
	REVISE_RUN_COMMAND,
} from "../application/approval-commands.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { SET_KEY_COMMAND } from "../application/key-command.js";
import type { Workspace } from "../application/workspaces-section.js";
import {
	type HomeAction,
	type HomeModel,
	homeModel,
	runsHere,
	waitingCount,
} from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { OPEN_ARTIFACT_COMMAND } from "./artifact-command.js";
import { OPEN_BOARD_COMMAND } from "./board-contribution.js";
import { MeteInboxBadge } from "./inbox-badge.js";

// What the METE view's sections show (docs/13, Home; ADR-078): the runs of the first open folder,
// asked of its daemon, and the folders Theia remembers. One store, so the sections never ask twice.
// It asks again on refresh() and on every run.* event of its folder.

@injectable()
export class MeteHomeStore {
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(MeteInboxBadge) protected readonly badge!: MeteInboxBadge;
	@inject(FileDialogService) protected readonly dialogs!: FileDialogService;

	protected readonly changed = new Emitter<void>();
	/** Fires when the model or the workspaces change. */
	readonly onDidChange = this.changed.event;
	model: HomeModel = { kind: "loading" };
	workspaces: readonly Workspace[] = [];
	/** The folder the shown runs belong to. */
	protected dir: string | undefined;

	@postConstruct()
	protected init(): void {
		// A run of the shown folder changed: ask again; run events are few, so no debounce.
		this.events.onDidReceive(({ workspaceDir, event }) => {
			if (workspaceDir === this.dir && event.type.startsWith("run."))
				void this.refresh();
		});
		// A key set from the palette or from the button restarts the daemon: ask again either way.
		this.commands.onDidExecuteCommand(({ commandId }) => {
			if (commandId === SET_KEY_COMMAND.id) void this.refresh();
		});
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
		this.changed.fire();
	}

	/** Asks the daemon of the first open folder again; the sections draw the answer. */
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

	// The quota chips and the lines under a quota pause add to the runs, which show without them;
	// a failed ask leaves them out, and METE: Quota says why it failed.
	protected async providers(dir: string) {
		const r = await this.daemon.quota(dir);
		return r.ok ? r.value.providers : [];
	}

	/** Runs a section's button as its palette command, so the keyboard and the mouse share one path. */
	act(action: HomeAction, runId: string) {
		const id = {
			approve: APPROVE_RUN_COMMAND.id,
			revise: REVISE_RUN_COMMAND.id,
			resume: RESUME_RUN_COMMAND.id,
			open: OPEN_BOARD_COMMAND.id,
			artifact: OPEN_ARTIFACT_COMMAND.id,
		}[action];
		return this.commands.executeCommand(id, runId);
	}

	/**
	 * Opens a folder in this window, or in a new one while a run here is running or queued, since
	 * this folder's daemon ends when the window takes another folder (ADR-078).
	 */
	openWorkspace(uri: string) {
		this.workspace.open(new URI(uri), {
			preserveWindow: !runsHere(this.model),
		});
	}

	/** Drops a folder from the list; the folder stays on disk. */
	async forgetWorkspace(uri: string) {
		await this.workspace.removeRecentWorkspace(uri);
		this.workspaces = this.workspaces.filter((w) => w.uri !== uri);
		this.changed.fire();
	}

	/** Asks for a folder and opens it as a click on the list would. */
	async addWorkspace() {
		const folder = await this.dialogs.showOpenDialog({
			title: nls.localize("mete/home/openFolder", "Open folder…"),
			canSelectFiles: false,
			canSelectFolders: true,
		});
		if (folder) this.openWorkspace(folder.toString());
	}

	protected setModel(model: HomeModel): void {
		this.model = model;
		this.badge.set(waitingCount(model));
		this.changed.fire();
	}
}
