import { err, ok, type ProviderState } from "@mete/contracts";
import { CommandService } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
import { WindowService } from "@theia/core/lib/browser/window/window-service";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import type { EndpointsActions } from "../application/endpoints-card.js";
import { panelRoot } from "../application/panel-root.js";
import type { Target } from "../application/section-draft.js";
import type { GroupId } from "../application/settings-groups.js";
import {
	type ApplyState,
	type SettingsModel,
	SettingsView,
} from "../application/settings-view.js";
import { failureText } from "../application/status-text.js";
import type { ToolCatalog } from "../application/tool-catalog.js";
import { activeRunsOf } from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { BindingsForm } from "./bindings-form.js";
import { EndpointKeys } from "./endpoint-keys.js";
import { EndpointTests } from "./endpoint-tests.js";
import { EndpointsForm } from "./endpoints-form.js";
import { McpForm } from "./mcp-form.js";
import {
	connectMcp,
	createMcpSettings,
	type McpSettings,
	probeMcp,
} from "./mcp-settings.js";
import type { McpTests } from "./mcp-tests.js";
import { MetePanelWidget } from "./panel-widget.js";
import { SettingsForms } from "./settings-forms.js";
import "../../style/mete.css";
import "../../style/mete-form.css";
import "../../style/mete-run.css";
import "../../style/mete-screen.css";
import "../../style/mete-settings.css";
import "../../style/mete-settings-body.css";
import "../../style/mete-endpoints.css";

/** The METE Settings screen in Theia's main area. */
@injectable()
export class MeteSettingsWidget extends MetePanelWidget {
	static readonly ID = "mete.settings";

	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(ThemeService) protected readonly themes!: ThemeService;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(FileService) protected readonly files!: FileService;
	@inject(WindowService) protected readonly windows!: WindowService;

	protected model: SettingsModel = { kind: "loading" };
	protected forms: SettingsForms | undefined;
	protected endpoints: EndpointsForm | undefined;
	protected bindings: BindingsForm | undefined;
	protected mcp: McpForm | undefined;
	protected keys: EndpointKeys | undefined;
	protected tests: EndpointTests | undefined;
	protected mcpTests: McpTests | undefined;
	protected catalog: ToolCatalog | undefined;
	protected mcpConnections: McpSettings | undefined;
	protected refreshRevision = 0;
	/** The providers' states from mete/quota, for the endpoints card (ADR-154). */
	protected states: readonly ProviderState[] | undefined;
	protected apply: ApplyState = { busy: false, activeRuns: 0 };
	/** The group the screen shows; not kept after a restart (ADR-095, ADR-086). */
	protected group: GroupId = "models";

	// No state, so Theia's saved layout leaves the tab out and a restart does not reopen it (ADR-086).
	storeState(): undefined {
		return undefined;
	}

	restoreState(): void {}

	@postConstruct()
	protected init(): void {
		this.id = MeteSettingsWidget.ID;
		this.title.label = nls.localize("mete/settings/title", "Settings");
		this.title.caption = nls.localize(
			"mete/settings/caption",
			"METE: the configuration it loaded",
		);
		this.title.iconClass = codicon("settings-gear");
		this.title.closable = true;
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.forms = new SettingsForms(this.files, () => this.update());
		this.endpoints = new EndpointsForm(this.files, () => this.update());
		this.bindings = new BindingsForm(this.files, () => this.update());
		this.mcp = new McpForm(this.files, () => this.update());
		this.keys = new EndpointKeys({
			setKey: (id, key) => this.daemon.setKey(id, key),
			activeRuns: () => this.folderRuns(),
			onSaved: () => void this.refresh(),
			onChange: () => this.update(),
		});
		this.tests = new EndpointTests({
			models: async (id) =>
				this.daemon.providerModels(await this.folderDir(), id),
			probe: async (id, models) =>
				this.daemon.providerTest(await this.folderDir(), id, models),
			onChange: () => this.update(),
		});
		this.initMcp();
		void this.refresh();
	}

	protected initMcp(): void {
		const mcp = createMcpSettings({
			daemon: this.daemon,
			windows: this.windows,
			dir: () => this.folderDir(),
			form: () => this.mcp,
			test: async (id) => this.testTool(id),
			changed: () => this.update(),
		});
		this.mcpTests = mcp.tests;
		this.mcpConnections = mcp.connections;
		this.catalog = mcp.catalog;
		this.toDispose.push(mcp);
		this.toDispose.push(
			this.workspace.onWorkspaceChanged(() => {
				this.apply = { busy: false, activeRuns: 0 };
				void this.refresh();
			}),
		);
	}

	/** Asks the daemon of the first open folder what configuration it loaded. */
	async refresh(): Promise<void> {
		const revision = ++this.refreshRevision;
		this.setModel({ kind: "loading" });
		await this.mcpConnections?.workspace(undefined);
		const [root] = await this.workspace.roots;
		if (revision !== this.refreshRevision) return;
		if (!root) return this.setModel({ kind: "no_folder" });
		const dir = root.resource.path.fsPath();
		// A restart invalidates earlier connection evidence.
		this.tests?.reset();
		this.mcpTests?.reset();
		this.states = undefined;
		const status = await this.runStatus(dir);
		if (revision !== this.refreshRevision) return;
		this.apply = {
			busy: this.apply.busy,
			activeRuns: status.ok ? (status.value ?? 0) : 0,
			error: status.ok ? undefined : status.error,
		};
		await this.loadSettings(root.resource, revision);
	}

	protected async loadSettings(resource: URI, revision: number): Promise<void> {
		const dir = resource.path.fsPath();
		const r = await this.daemon.settings(dir);
		if (revision !== this.refreshRevision) return;
		// The forms read their files from disk, not the loaded values (ADR-082).
		if (!r.ok) return this.setModel({ kind: "failed", failure: r.error });
		await this.forms?.load(resource, r.value.globalFile);
		await this.endpoints?.load(resource, r.value.globalFile);
		await this.bindings?.load(resource, r.value.globalFile);
		await this.mcp?.load(resource, r.value.globalFile);
		if (revision !== this.refreshRevision) return;
		await this.mcpConnections?.workspace(dir);
		if (revision !== this.refreshRevision) return;
		this.setModel({ kind: "settings", settings: r.value });
		// The states wait on the daemon's first model listing, so they follow the forms (ADR-154).
		const q = await this.daemon.quota(dir);
		if (revision !== this.refreshRevision) return;
		this.states = q.ok ? q.value.providers : undefined;
		this.update();
	}

	// An unavailable status is not evidence that restarting is safe (ADR-180).
	protected async runStatus(dir: string) {
		const r = await this.daemon.status(dir);
		if (!r.ok && r.error.code === "not_ready") return ok(undefined);
		return r.ok ? ok(activeRunsOf(r.value)) : err(failureText(r.error));
	}

	// Apply now (ADR-083): checks the runs again, restarts the daemon, and shows what it loaded.
	protected async applyNow(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root || this.apply.busy) return;
		const dir = root.resource.path.fsPath();
		this.apply = { busy: true, activeRuns: 0, error: undefined };
		this.update();
		try {
			const status = await this.runStatus(dir);
			if (!status.ok) {
				this.apply = { busy: false, activeRuns: 0, error: status.error };
				return;
			}
			if (status.value !== undefined && status.value > 0) {
				this.apply = { busy: false, activeRuns: status.value };
				return;
			}
			const restarted = await this.daemon.restartIdle(dir);
			if (restarted.ok) await this.refresh();
			else this.apply = { ...this.apply, error: failureText(restarted.error) };
		} catch (error) {
			this.apply = { busy: false, activeRuns: 0, error: String(error) };
		} finally {
			this.apply = { ...this.apply, busy: false };
			this.update();
		}
	}

	protected async folderRuns(): Promise<number> {
		const [root] = await this.workspace.roots;
		if (!root) return Number.POSITIVE_INFINITY;
		const result = await this.runStatus(root.resource.path.fsPath());
		return result.ok
			? (result.value ?? Number.POSITIVE_INFINITY)
			: Number.POSITIVE_INFINITY;
	}

	protected async connectTool(id: string): Promise<void> {
		const revision = this.refreshRevision;
		await connectMcp({
			id,
			dir: () => this.folderDir(),
			form: this.mcp,
			tests: this.mcpTests,
			connections: this.mcpConnections,
			busy: this.apply.busy,
			current: () => revision === this.refreshRevision,
			status: (dir) => this.runStatus(dir),
			daemon: this.daemon,
			loaded: async (dir) => {
				const result = await this.daemon.settings(dir);
				if (
					!result.ok ||
					(this.mcpConnections && this.mcpConnections.dir !== dir)
				)
					return false;
				this.setModel({ kind: "settings", settings: result.value });
				this.tests?.reset();
				this.mcpTests?.reset();
				return true;
			},
			changed: (state) => {
				if (revision !== this.refreshRevision) return;
				this.apply = state;
				this.update();
			},
		});
	}

	protected async testTool(id: string) {
		const revision = this.refreshRevision,
			dir = await this.folderDir();
		return probeMcp({
			id,
			form: this.mcp?.form(),
			dir,
			daemon: this.daemon,
			connections: this.mcpConnections,
			blocked: revision !== this.refreshRevision,
		});
	}

	protected async folderDir(): Promise<string> {
		const [root] = await this.workspace.roots;
		return root?.resource.path.fsPath() ?? "";
	}

	// The endpoints card with each endpoint's key field (ADR-087).
	protected endpointsView() {
		const form = this.endpoints?.form();
		const { keys, tests } = this;
		if (!form || !keys || !tests) return form;
		return {
			state: form.state,
			actions: this.keyedActions(form.actions, keys),
			states: this.states,
			keys: {
				stateOf: (slug: string) => keys.stateOf(slug),
				onType: (slug: string, key: string) => keys.type(slug, key),
				onSet: (slug: string) => void keys.set(slug),
				activeRuns: this.apply.activeRuns,
			},
			tests: {
				stateOf: (slug: string) => tests.stateOf(slug),
				onList: (slug: string) => void tests.list(slug),
				onPick: (slug: string, model: string, on: boolean) =>
					tests.pick(slug, model, on),
				onProbe: (slug: string) => void tests.probe(slug),
			},
		};
	}

	protected mcpView() {
		const form = this.mcp?.form();
		const tests = this.mcpTests;
		if (!form || !tests || !this.mcpConnections) return form;
		return this.mcpConnections.view(form, tests, {
			busy: this.apply.busy,
			connect: (id) => void this.connectTool(id),
			catalog: this.catalog,
		});
	}

	// Typed keys are kept by slug, so they follow a slug edit and go with a removed endpoint.
	protected keyedActions(
		actions: EndpointsActions,
		keys: EndpointKeys,
	): EndpointsActions {
		// The list as it is now: two keystrokes can come before the card draws again.
		const slugAt = (i: number) =>
			this.endpoints?.form()?.state.list[i]?.slug ?? "";
		return {
			...actions,
			onEdit: (i, field, value) => {
				if (field === "slug") keys.rename(slugAt(i), value);
				actions.onEdit(i, field, value);
			},
			onRemove: (i) => {
				keys.forget(slugAt(i));
				actions.onRemove(i);
			},
		};
	}

	// The scope switch (ADR-095) moves every form and the two cards that follow it (ADR-096, ADR-097).
	protected async scope(target: Target): Promise<void> {
		if (this.apply.busy) return;
		const revision = ++this.refreshRevision;
		const dir = this.mcpConnections?.dir;
		this.apply = { ...this.apply, busy: true };
		await this.mcpConnections?.workspace(undefined);
		this.catalog?.reset();
		this.mcpTests?.reset();
		await Promise.all([
			this.forms?.retargetAll(target),
			this.bindings?.retarget(target),
			this.mcp?.retarget(target),
		]);
		if (revision !== this.refreshRevision) return;
		await this.mcpConnections?.workspace(dir);
		if (revision !== this.refreshRevision) return;
		this.apply = { ...this.apply, busy: false };
		this.update();
	}

	// Save every changed section to its selected target (ADR-095).
	protected async saveAll(): Promise<void> {
		await this.forms?.saveAll();
		await this.bindings?.save();
		const mcp = this.mcp?.form();
		if (mcp?.state.dirty && (await this.mcp?.save()))
			this.mcpTests?.saved(mcp.state.servers);
		if (this.endpoints?.form()?.state.dirty) await this.endpoints.save();
	}

	protected setModel(model: SettingsModel): void {
		this.model = model;
		this.update();
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				<SettingsView
					model={this.model}
					forms={this.forms?.forms() ?? {}}
					endpoints={this.endpointsView()}
					bindings={this.bindings?.form()}
					mcp={this.mcpView()}
					apply={this.apply}
					choice={{
						group: this.group,
						onGroup: (group) => {
							this.group = group;
							this.update();
						},
					}}
					actions={{
						onApply: () => void this.applyNow(),
						onCommand: (id) => void this.commands.executeCommand(id),
						onOpen: (file) => void open(this.openers, URI.fromFilePath(file)),
						onRefresh: () => void this.refresh(),
						onScope: (target) => void this.scope(target),
						onSaveAll: () => void this.saveAll(),
					}}
				/>
			</div>
		);
	}
}
