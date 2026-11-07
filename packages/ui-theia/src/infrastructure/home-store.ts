import { CommandService } from "@theia/core";
import { DisposableCollection } from "@theia/core/lib/common/disposable";
import { Emitter } from "@theia/core/lib/common/event";
import { ILogger } from "@theia/core/lib/common/logger";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import {
	inject,
	injectable,
	postConstruct,
	preDestroy,
} from "@theia/core/shared/inversify";
import { FileDialogService } from "@theia/filesystem/lib/browser/file-dialog/file-dialog-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	APPROVE_RUN_COMMAND,
	REMOVE_RUN_COMMAND,
	RESUME_RUN_COMMAND,
	REVISE_RUN_COMMAND,
} from "../application/approval-commands.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { SET_KEY_COMMAND } from "../application/key-command.js";
import { createThreadList } from "../application/thread-list.js";
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
	@inject(ILogger) protected readonly logger!: ILogger;

	protected readonly changed = new Emitter<void>();
	/** Fires when the model or the workspaces change. */
	readonly onDidChange = this.changed.event;
	model: HomeModel = { kind: "loading" };
	workspaces: readonly Workspace[] = [];
	/** The folder the shown runs belong to. */
	protected dir: string | undefined;
	protected generation = 0;
	protected disposed = false;
	protected readonly subscriptions = new DisposableCollection(this.changed);
	readonly conversations = createThreadList({
		fetch: (dir, input) => this.daemon.threadList(dir, input),
		onChange: () => this.changed.fire(),
	});

	@postConstruct()
	protected init(): void {
		// A run of the shown folder changed: ask again; run events are few, so no debounce.
		this.subscriptions.push(
			this.events.onDidReceive(({ workspaceDir, event }) => {
				if (workspaceDir === this.dir && event.type.startsWith("run."))
					void this.refresh();
			}),
		);
		// A key set from the palette or from the button restarts the daemon: ask again either way.
		this.subscriptions.push(
			this.commands.onDidExecuteCommand(({ commandId }) => {
				if (commandId === SET_KEY_COMMAND.id) void this.refresh();
			}),
		);
		this.subscriptions.push(
			this.workspace.onWorkspaceChanged(() => void this.refresh()),
		);
		void this.refresh();
	}

	/** Invalidates pending refreshes and releases the store's listeners. */
	@preDestroy()
	dispose(): void {
		this.disposed = true;
		this.generation++;
		this.conversations.clear();
		this.subscriptions.dispose();
	}

	// The folders opened before, newest first, as Theia remembers them (docs/13, Home: Workspaces).
	protected async loadWorkspaces(current: string | undefined, asked: number) {
		const dir = this.dir;
		try {
			const recent = await this.workspace.recentWorkspaces();
			if (!this.isCurrent(asked, dir)) return;
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
		} catch (e) {
			if (this.isCurrent(asked, dir))
				void this.logger
					.warn("METE Home could not read recent workspaces.", e)
					.catch((error: unknown) => console.error(error));
		}
	}

	/** Asks the daemon of the first open folder again; the sections draw the answer. */
	async refresh(): Promise<void> {
		if (this.disposed) return;
		const asked = ++this.generation;
		let dir: string | undefined;
		try {
			// The roots promise waits for the workspace to load.
			const [root] = await this.workspace.roots;
			dir = root?.resource.path.fsPath();
			if (!this.isCurrent(asked, dir)) return;
			this.dir = dir;
			void this.loadWorkspaces(root?.resource.toString(), asked);
			if (!dir) {
				this.conversations.clear();
				return this.setModel({ kind: "no_folder" });
			}
			void this.conversations.show(dir);
			if (this.model.kind !== "runs") this.setModel({ kind: "loading" });
			const reply = await this.daemon.status(dir);
			if (!this.isCurrent(asked, dir)) return;
			const at = new Date().toISOString();
			// Runs draw before the potentially slow first model listing.
			this.setModel(homeModel(reply, at));
			if (!reply.ok) return;
			const providers = await this.providers(dir, asked);
			if (this.isCurrent(asked, dir))
				this.setModel(homeModel(reply, at, providers));
		} catch (e) {
			if (!this.isCurrent(asked, dir)) return;
			this.setModel(
				homeModel(
					{ ok: false, error: { code: "protocol", detail: String(e) } },
					new Date().toISOString(),
				),
			);
		}
	}

	protected isCurrent(asked: number, dir: string | undefined): boolean {
		return (
			!this.disposed &&
			asked === this.generation &&
			dir === this.workspace.tryGetRoots()[0]?.resource.path.fsPath()
		);
	}

	// The quota chips and the lines under a quota pause add to the runs, which show without them;
	// a failed ask leaves them out, and METE: Quota says why it failed.
	protected async providers(dir: string, asked: number) {
		try {
			const r = await this.daemon.quota(dir);
			return r.ok ? r.value.providers : [];
		} catch (e) {
			if (this.isCurrent(asked, dir))
				void this.logger
					.warn("METE Home could not read quota states.", e)
					.catch((error: unknown) => console.error(error));
			return [];
		}
	}

	/** Runs a section's button as its palette command, so the keyboard and the mouse share one path. */
	act(action: HomeAction, runId: string) {
		const id = {
			approve: APPROVE_RUN_COMMAND.id,
			revise: REVISE_RUN_COMMAND.id,
			resume: RESUME_RUN_COMMAND.id,
			open: OPEN_BOARD_COMMAND.id,
			artifact: OPEN_ARTIFACT_COMMAND.id,
			remove: REMOVE_RUN_COMMAND.id,
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
