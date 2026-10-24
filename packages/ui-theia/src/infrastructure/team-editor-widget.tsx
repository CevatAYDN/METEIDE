import { NeedSchema, TierSchema } from "@mete/contracts";
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
import {
	chainKey,
	isEmpty,
	type PinsDraft,
	pinsIssue,
	pinsOf,
	pinsOfTeam,
	withPin,
} from "../application/pins-draft.js";
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
	selectedAfterRemove,
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
// service. Only the user's Save runs the write (ADR-072). A member's pin goes to the folder's
// .mete/pins.yaml when the user leaves its field, apart from the team's Save (ADR-077).

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
	/** The member whose form shows beside the grid (ADR-093). */
	protected selected = 0;
	protected root: URI | undefined;
	/** The folder's pins file; undefined while it does not parse, so it is never written over. */
	protected pins: PinsDraft | undefined;
	protected pinsError: string | undefined;
	/** Each tier's chain for the pin's suggestions, fetched once per tier and needs. */
	protected readonly chains = new Map<string, readonly string[]>();

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
		this.selected = 0;
		await this.readPins();
		this.setModel(this.readyOf(r.value.source, false));
	}

	protected pinsFile(): URI | undefined {
		return this.root?.resolve(".mete/pins.yaml");
	}

	protected async readPins(): Promise<void> {
		const file = this.pinsFile();
		if (!file) return;
		try {
			const text = (await this.files.exists(file))
				? (await this.files.read(file)).value
				: undefined;
			const r = pinsOf(text);
			this.pins = r.ok ? r.value : undefined;
			this.pinsError = r.ok ? undefined : r.error;
		} catch (e) {
			this.pins = undefined;
			this.pinsError = String(e);
		}
	}

	// The models each member's tier would try, asked once per tier and needs; a failed ask offers none.
	protected async fetchChains(team: ReturnType<typeof teamOf>): Promise<void> {
		const root = this.root?.path.fsPath();
		if (!root) return;
		let fetched = false;
		for (const r of team.roles) {
			const key = chainKey(r.tier, r.needs);
			const tier = TierSchema.safeParse(r.tier);
			if (this.chains.has(key) || !tier.success) continue;
			this.chains.set(key, []);
			const needs = NeedSchema.array().parse(
				r.needs.filter((n) => NeedSchema.safeParse(n).success),
			);
			const got = await this.daemon.chain(root, tier.data, needs);
			if (!got.ok) continue;
			this.chains.set(
				key,
				got.value.models.map((m) => `${m.providerId}/${m.modelId}`),
			);
			fetched = true;
		}
		if (fetched && this.model.kind === "ready")
			this.setModel({ ...this.model, chains: Object.fromEntries(this.chains) });
	}

	// A pin is the folder's own setting: it is written at once, never with the team's Save, and a file
	// left with no pin is deleted.
	protected async pin(
		roleId: string,
		value: string | undefined,
	): Promise<void> {
		const file = this.pinsFile();
		if (this.model.kind !== "ready" || !file) return;
		if (!this.pins)
			return void this.messages.warn(
				nls.localize(
					"mete/team/pinsUnreadable",
					"METE cannot read .mete/pins.yaml, so it does not change it: {0}",
					this.pinsError ?? "",
				),
			);
		const teamId = this.model.team.metadata.id;
		const next = withPin(this.pins, teamId, roleId, value);
		const issue = pinsIssue(next);
		if (issue)
			return void this.messages.warn(
				nls.localize(
					"mete/team/pinRefused",
					"This pin is not saved: {0}",
					issue,
				),
			);
		try {
			if (!isEmpty(next)) await this.files.write(file, next.toString());
			else if (await this.files.exists(file)) await this.files.delete(file);
		} catch (e) {
			return void this.messages.error(
				nls.localize(
					"mete/team/pinNotSaved",
					"METE could not save the pin: {0}",
					String(e),
				),
			);
		}
		this.pins = next;
		this.setModel({ ...this.model, pins: pinsOfTeam(next, teamId) });
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
		void this.fetchChains(team);
		return {
			kind: "ready",
			team,
			source,
			fixedIds,
			issues,
			busy: false,
			changed,
			selected: Math.min(this.selected, team.roles.length - 1),
			pins: this.pins ? pinsOfTeam(this.pins, team.metadata.id) : {},
			chains: Object.fromEntries(this.chains),
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

	protected select(index: number): void {
		this.selected = index;
		if (this.model.kind === "ready")
			this.setModel({ ...this.model, selected: index });
	}

	// A new member is selected, so its form is the one to fill in.
	protected addMember(): void {
		if (this.model.kind !== "ready") return;
		this.selected = this.model.team.roles.length;
		this.change(addRole);
	}

	protected removeMember(index: number): void {
		if (this.model.kind !== "ready") return;
		this.selected = selectedAfterRemove(
			this.selected,
			index,
			this.model.team.roles.length - 1,
		);
		this.change((d) => removeRole(d, index));
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
			onSelectMember: (i) => this.select(i),
			onAddMember: () => this.addMember(),
			onRemoveMember: (i) => this.removeMember(i),
			onRenameMember: (i, id) => this.rename(i, id),
			onPin: (roleId, value) => void this.pin(roleId, value),
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
