import { MessageService } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import type { StatefulWidget } from "@theia/core/lib/browser/shell/shell-layout-restorer";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { nls } from "@theia/core/lib/common/nls";
import type URI from "@theia/core/lib/common/uri";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
// The design system of docs/13 on every METE panel (ADR-069); the bundle inlines its font.
import "../../style/mete.css";
import { panelRoot } from "../application/panel-root.js";
import { failureText } from "../application/status-text.js";
import {
	addRole,
	addTask,
	copyAs,
	type Draft,
	draftOf,
	edited,
	issuesOf,
	removeRole,
	removeTask,
	renameRole,
	teamOf,
} from "../application/team-draft.js";
import {
	type TeamEditorActions,
	type TeamEditorModel,
	TeamEditorView,
} from "../application/team-editor-view.js";
import { MeteDaemonService } from "../domain/status-service.js";

// The team editor (docs/13, Settings, Templates; ADR-075) of the first open folder: it reads a
// template through the daemon and writes the workspace's .mete/teams/<id>.yaml with Theia's file
// service. Only the user's Save runs the write (ADR-072).

/** The METE team editor in Theia's main area. */
@injectable()
export class MeteTeamEditorWidget
	extends ReactWidget
	implements StatefulWidget
{
	static readonly ID = "mete.team-editor";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(FileService) protected readonly files!: FileService;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(MessageService) protected readonly messages!: MessageService;

	protected model: TeamEditorModel = { kind: "none" };
	protected doc: Draft | undefined;
	protected root: URI | undefined;

	@postConstruct()
	protected init(): void {
		this.id = MeteTeamEditorWidget.ID;
		this.title.label = nls.localize("mete/team/title", "Edit team");
		this.title.caption = nls.localize("mete/team/caption", "METE: edit a team");
		this.title.iconClass = codicon("organization");
		this.title.closable = true;
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.update();
	}

	// Theia restores the tab after a restart: it reopens the team it showed; unsaved edits are not kept.
	storeState(): object | undefined {
		return this.model.kind === "ready"
			? { id: this.model.team.metadata.id }
			: undefined;
	}

	restoreState(state: object): void {
		if ("id" in state && typeof state.id === "string") void this.load(state.id);
	}

	/** Reads the template with this id through the daemon of the first open folder. */
	async load(id: string): Promise<void> {
		if (!(await this.mayLeave(id))) return;
		const [root] = await this.workspace.roots;
		this.root = root?.resource;
		if (!this.root) return this.setModel({ kind: "no_folder" });
		this.setModel({ kind: "loading" });
		const r = await this.daemon.readTemplate(this.root.path.fsPath(), id);
		if (!r.ok)
			return this.setModel({ kind: "failed", text: failureText(r.error) });
		const doc = draftOf(r.value.yaml);
		if (!doc.ok) return this.setModel({ kind: "failed", text: doc.error });
		this.doc = doc.value;
		this.setModel(this.readyOf(r.value.source, false));
	}

	// Opening another team over unsaved changes asks first, since the draft would be lost.
	// shortcut: closing the tab still drops unsaved changes; make the widget a Theia Saveable for that.
	protected async mayLeave(id: string): Promise<boolean> {
		const m = this.model;
		if (m.kind !== "ready" || !m.changed) return true;
		// The same team is already open with its changes: keep them.
		if (m.team.metadata.id === id) return false;
		const discard = nls.localize("mete/team/discard", "Discard changes");
		const answer = await this.messages.warn(
			nls.localize(
				"mete/team/unsaved",
				"The team {0} has unsaved changes.",
				m.team.metadata.id,
			),
			discard,
			nls.localize("mete/team/keep", "Keep editing"),
		);
		return answer === discard;
	}

	protected readyOf(
		source: "workspace" | "builtIn",
		changed: boolean,
	): TeamEditorModel {
		const doc = this.doc;
		if (!doc) return { kind: "loading" };
		const team = teamOf(doc);
		const fixedIds =
			this.model.kind === "ready" && changed
				? this.model.fixedIds
				: team.roles.map((r) => r.id);
		const issues = issuesOf(doc);
		return {
			kind: "ready",
			team,
			source,
			fixedIds,
			issues,
			busy: false,
			changed,
		};
	}

	protected change(next: (doc: Draft) => Draft): void {
		if (!this.doc || this.model.kind !== "ready") return;
		this.doc = next(this.doc);
		this.setModel(this.readyOf(this.model.source, true));
	}

	protected fileOf(id: string): URI | undefined {
		return this.root?.resolve(`.mete/teams/${id}.yaml`);
	}

	// Save writes the draft to the workspace's copy, a built-in team's too, which then wins (docs/08).
	protected async save(doc: Draft): Promise<void> {
		const id = teamOf(doc).metadata.id;
		const file = this.fileOf(id);
		if (!file || this.model.kind !== "ready" || issuesOf(doc).length > 0)
			return;
		const before = this.model;
		this.setModel({ ...before, busy: true });
		try {
			await this.files.write(file, doc.toString());
		} catch (e) {
			this.setModel(before);
			return void this.messages.error(
				nls.localize(
					"mete/team/notSaved",
					"METE could not save the team: {0}",
					String(e),
				),
			);
		}
		this.doc = doc;
		this.model = { kind: "loading" };
		this.setModel(this.readyOf("workspace", false));
		void this.messages.info(
			nls.localize("mete/team/saved", "Saved .mete/teams/{0}.yaml", id),
		);
	}

	// A copy never replaces a team: an id the daemon already reads, in either folder, is refused.
	protected async saveAs(id: string, name: string): Promise<void> {
		if (!this.doc || !this.root) return;
		const taken = await this.daemon.readTemplate(this.root.path.fsPath(), id);
		if (taken.ok)
			return void this.messages.warn(
				nls.localize(
					"mete/team/taken",
					"A team with the id {0} already exists.",
					id,
				),
			);
		await this.save(copyAs(this.doc, id, name));
	}

	// A refused id is said, as the field shows the member's own id again.
	protected rename(index: number, id: string): void {
		const r = this.doc && renameRole(this.doc, index, id);
		if (!r) return;
		if (r.ok) this.change(() => r.value);
		else
			void this.messages.warn(
				nls.localize(
					"mete/team/memberTaken",
					"Another member already has the id {0}, so this member keeps its id.",
					r.error.taken,
				),
			);
	}

	protected async openYaml(): Promise<void> {
		const file = this.doc && this.fileOf(teamOf(this.doc).metadata.id);
		if (file) await open(this.openers, file);
	}

	protected setModel(model: TeamEditorModel): void {
		this.model = model;
		this.update();
	}

	protected actions(): TeamEditorActions {
		return {
			onEdit: (path, value) => this.change((d) => edited(d, path, value)),
			onAddMember: () => this.change(addRole),
			onRemoveMember: (i) => this.change((d) => removeRole(d, i)),
			onRenameMember: (i, id) => this.rename(i, id),
			onAddTask: (roleId) => this.change((d) => addTask(d, roleId)),
			onRemoveTask: (i) => this.change((d) => removeTask(d, i)),
			onSave: () => void (this.doc && this.save(this.doc)),
			onSaveAs: (id, name) => void this.saveAs(id, name),
			onOpenYaml: () => void this.openYaml(),
		};
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<TeamEditorView model={this.model} actions={this.actions()} />
			</div>
		);
	}
}
