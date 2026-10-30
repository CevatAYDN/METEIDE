import { CommandService } from "@theia/core";
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
import {
	type MemoryItem,
	type MemoryModel,
	MemoryView,
} from "../application/memory-view.js";
import { panelRoot } from "../application/panel-root.js";
import { NOTE_FOLDERS, noteOf } from "../domain/memory.js";
import { START_RUN_COMMAND } from "./board-contribution.js";
import { MetePanelWidget } from "./panel-widget.js";
import "../../style/mete.css";
import "../../style/mete-screen.css";
import "../../style/mete-assets.css";
import "../../style/mete-memory.css";

// The Memory screen in Theia's main area (docs/13, Knowledge; ADR-159): the notes of the first open
// folder's workspace vault, .mete/knowledge/, read through Theia's file service as the Assets view
// reads .mete/assets/. A refresh and coming back to the screen read them again.

/** The METE Memory screen in Theia's main area. */
@injectable()
export class MeteMemoryWidget extends MetePanelWidget {
	static readonly ID = "mete.memory";

	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(FileService) protected readonly files!: FileService;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;

	protected model: MemoryModel = { kind: "loading" };

	@postConstruct()
	protected init(): void {
		this.id = MeteMemoryWidget.ID;
		this.title.label = nls.localize("mete/memory/title", "Memory");
		this.title.caption = nls.localize(
			"mete/memory/caption",
			"METE: what the agents learned and what the runs left",
		);
		this.title.iconClass = codicon("book");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		void this.refresh();
	}

	// A run that just ended wrote its report: coming to the screen reads the vault again.
	protected override onActivateRequest(msg: Message): void {
		super.onActivateRequest(msg);
		void this.refresh();
	}

	/** Reads the notes of the first open folder's workspace vault. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		const vault = root.resource.resolve(".mete/knowledge");
		try {
			const notes = await Promise.all(
				Object.keys(NOTE_FOLDERS).map((f) => this.notesIn(vault, f)),
			);
			this.setModel({ kind: "notes", notes: notes.flat() });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setModel({ kind: "failed", message });
		}
	}

	// shortcut: one folder level, as METE writes notes; read sub-folders when users nest notes in Obsidian.
	protected async notesIn(vault: URI, folder: string): Promise<MemoryItem[]> {
		const dir = vault.resolve(folder);
		if (!(await this.files.exists(dir))) return [];
		const children = (await this.files.resolve(dir, { resolveMetadata: true }))
			.children;
		const files = (children ?? []).filter(
			(c) => !c.isDirectory && c.name.toLowerCase().endsWith(".md"),
		);
		const notes = await Promise.all(
			files.map(async (c) => {
				const text = (await this.files.read(c.resource)).value;
				const note = noteOf(`${folder}/${c.name}`, text, c.mtime);
				return note && { ...note, url: c.resource.toString() };
			}),
		);
		return notes.filter((n) => n !== undefined);
	}

	protected setModel(model: MemoryModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<MemoryView
					model={this.model}
					onOpen={(url) => void open(this.openers, new URI(url))}
					onRefresh={() => void this.refresh()}
					onNewRun={() =>
						void this.commands.executeCommand(START_RUN_COMMAND.id)
					}
				/>
			</div>
		);
	}
}
