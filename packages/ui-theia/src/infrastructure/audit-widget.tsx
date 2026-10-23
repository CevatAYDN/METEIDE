import { MessageService } from "@theia/core";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileDialogService } from "@theia/filesystem/lib/browser/file-dialog/file-dialog-service";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	type AuditModel,
	AuditView,
	auditJson,
} from "../application/audit-view.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import {
	type AuditFilter,
	MeteDaemonService,
} from "../domain/status-service.js";

// The Audit log view (docs/13; ADR-053) of the first open folder: it asks the daemon again when it
// opens, on Refresh, on a filter change and on every run.* event of its folder. Export writes the
// rows shown as JSON to a file the user picks in the system's save dialog.

/** The METE Audit log view in Theia's main area. */
@injectable()
export class MeteAuditWidget extends ReactWidget {
	static readonly ID = "mete.audit";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonEvents) protected readonly events!: MeteDaemonEvents;
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(FileDialogService) protected readonly dialogs!: FileDialogService;
	@inject(FileService) protected readonly files!: FileService;

	protected model: AuditModel = { kind: "loading" };
	protected filter: AuditFilter = {};
	protected runs: readonly { readonly id: string; readonly goal: string }[] =
		[];
	protected dir: string | undefined;

	@postConstruct()
	protected init(): void {
		this.id = MeteAuditWidget.ID;
		this.title.label = nls.localize("mete/audit/title", "Audit log");
		this.title.caption = nls.localize(
			"mete/audit/caption",
			"METE: the policy's decisions",
		);
		this.title.iconClass = codicon("shield");
		this.title.closable = true;
		this.toDispose.push(
			this.events.onDidReceive(({ workspaceDir, event }) => {
				if (workspaceDir === this.dir && event.type.startsWith("run."))
					void this.refresh();
			}),
		);
		void this.refresh();
	}

	/** Asks the daemon of the first open folder for its runs and the audit rows that match. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		this.dir = root.resource.path.fsPath();
		const status = await this.daemon.status(this.dir);
		this.runs = status.ok
			? status.value.map((r) => ({ id: r.id, goal: r.goal }))
			: [];
		const r = await this.daemon.audit(this.dir, this.filter);
		this.setModel(
			r.ok
				? { kind: "rows", entries: r.value.entries }
				: { kind: "failed", failure: r.error },
		);
	}

	// The save dialog is the system's own; the file gets the rows the view shows.
	protected async export(): Promise<void> {
		if (this.model.kind !== "rows") return;
		const entries = this.model.entries;
		const uri = await this.dialogs.showSaveDialog({
			title: nls.localize("mete/audit/exportTitle", "Export the audit log"),
			inputValue: "audit-log.json",
		});
		if (!uri) return;
		await this.files.write(uri, auditJson(entries));
		void this.messages.info(
			nls.localize(
				"mete/audit/exported",
				"Exported {0} audit row(s).",
				entries.length,
			),
		);
	}

	protected setModel(model: AuditModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<AuditView
				model={this.model}
				controls={{
					filter: this.filter,
					runs: this.runs,
					onFilter: (filter) => {
						this.filter = filter;
						void this.refresh();
					},
					onExport: () => void this.export(),
					onRefresh: () => void this.refresh(),
				}}
			/>
		);
	}
}
