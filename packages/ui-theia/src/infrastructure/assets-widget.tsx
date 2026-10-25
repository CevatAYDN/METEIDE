import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { Message } from "@theia/core/shared/@lumino/messaging";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { type AssetsModel, AssetsView } from "../application/assets-view.js";
import { panelRoot } from "../application/panel-root.js";
import { assetRows, parseManifest } from "../domain/assets.js";
import { MetePanelWidget } from "./panel-widget.js";
import { textOf } from "./settings-forms.js";

// The Assets view in Theia's main area (docs/13, Assets; ADR-114): the files tools save under
// .mete/assets/ of the first open folder, newest first, joined with the MCP client's manifest.
// A refresh re-reads both; opening a file goes through Theia's own openers.

/** The METE Assets view in Theia's main area. */
@injectable()
export class MeteAssetsWidget extends MetePanelWidget {
	static readonly ID = "mete.assets";

	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(FileService) protected readonly files!: FileService;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(ThemeService) protected readonly themes!: ThemeService;

	protected model: AssetsModel = { kind: "loading" };

	@postConstruct()
	protected init(): void {
		this.id = MeteAssetsWidget.ID;
		this.title.label = nls.localize("mete/assets/title", "Assets");
		this.title.caption = nls.localize(
			"mete/assets/caption",
			"METE: the files tools saved",
		);
		this.title.iconClass = codicon("file-media");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		void this.refresh();
	}

	// Coming to the panel re-reads the folder: a run that just saved a file needs no Refresh click.
	protected override onActivateRequest(msg: Message): void {
		super.onActivateRequest(msg);
		void this.refresh();
	}

	/** Reads the first open folder's .mete/assets/ and its manifest. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		const dir = root.resource.resolve(".mete/assets");
		try {
			const manifest = parseManifest(
				(await textOf(this.files, dir.resolve("manifest.jsonl"))) ?? "",
			);
			const rows = assetRows(await this.filesOf(dir), manifest);
			this.setModel({
				kind: "rows",
				rows: rows.map((row) => ({
					...row,
					url: dir.resolve(row.name).toString(),
				})),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setModel({ kind: "failed", message });
		}
	}

	// The folder's files; a missing folder is the empty case, not an error.
	protected async filesOf(dir: URI) {
		if (!(await this.files.exists(dir))) return [];
		const stat = await this.files.resolve(dir);
		return (stat.children ?? [])
			.filter((child) => !child.isDirectory)
			.map((child) => ({
				name: child.name,
				bytes: child.size ?? 0,
				...(child.mtime === undefined ? {} : { mtime: child.mtime }),
			}));
	}

	protected setModel(model: AssetsModel): void {
		this.model = model;
		this.update();
	}

	protected open(url: string): void {
		void open(this.openers, new URI(url));
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<AssetsView
					model={this.model}
					onOpen={(url) => this.open(url)}
					onRefresh={() => void this.refresh()}
				/>
			</div>
		);
	}
}
