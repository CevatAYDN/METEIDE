import { CommandService } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { codicon } from "@theia/core/lib/browser/widgets/widget";
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
import { activeRunsOf } from "../domain/home-model.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { BindingsForm } from "./bindings-form.js";
import { EndpointKeys } from "./endpoint-keys.js";
import { EndpointTests } from "./endpoint-tests.js";
import { EndpointsForm } from "./endpoints-form.js";
import { McpForm } from "./mcp-form.js";
import { MetePanelWidget } from "./panel-widget.js";
import { SettingsForms } from "./settings-forms.js";
import "../../style/mete.css";
import "../../style/mete-form.css";
import "../../style/mete-run.css";
import "../../style/mete-settings.css";
import "../../style/mete-settings-body.css";

// The read-only Settings screen (docs/13; ADR-081) of the first open folder: it asks the daemon
// what it loaded when it opens and on Refresh; a file opens in Theia's editor.

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

	protected model: SettingsModel = { kind: "loading" };
	protected forms: SettingsForms | undefined;
	protected endpoints: EndpointsForm | undefined;
	protected bindings: BindingsForm | undefined;
	protected mcp: McpForm | undefined;
	protected keys: EndpointKeys | undefined;
	protected tests: EndpointTests | undefined;
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
		void this.refresh();
	}

	/** Asks the daemon of the first open folder what configuration it loaded. */
	async refresh(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root) return this.setModel({ kind: "no_folder" });
		const dir = root.resource.path.fsPath();
		// A restarted daemon may have loaded other endpoints, so earlier Test answers go.
		this.tests?.reset();
		this.apply = { ...this.apply, activeRuns: await this.activeRuns(dir) };
		const r = await this.daemon.settings(dir);
		this.setModel(
			r.ok
				? { kind: "settings", settings: r.value }
				: { kind: "failed", failure: r.error },
		);
		// The forms read their files from disk, not the loaded values (ADR-082).
		if (!r.ok) return;
		await this.forms?.load(root.resource, r.value.globalFile);
		await this.endpoints?.load(root.resource, r.value.globalFile);
		await this.bindings?.load(root.resource, r.value.globalFile);
		await this.mcp?.load(root.resource, r.value.globalFile);
	}

	// Runs a restart would pause (ADR-083): queued or running ones; none when the status fails.
	protected async activeRuns(dir: string): Promise<number> {
		const r = await this.daemon.status(dir);
		return r.ok ? activeRunsOf(r.value) : 0;
	}

	// Apply now (ADR-083): checks the runs again, restarts the daemon, and shows what it loaded.
	protected async applyNow(): Promise<void> {
		const [root] = await this.workspace.roots;
		if (!root || this.apply.busy) return;
		const activeRuns = await this.activeRuns(root.resource.path.fsPath());
		this.apply = { busy: activeRuns === 0, activeRuns };
		this.update();
		if (activeRuns > 0) return;
		await this.daemon.restart();
		this.apply = { busy: false, activeRuns: 0 };
		await this.refresh();
	}

	protected async folderRuns(): Promise<number> {
		const [root] = await this.workspace.roots;
		return root ? this.activeRuns(root.resource.path.fsPath()) : 0;
	}

	// The card shows only while a folder is open, so a Test always has one.
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
		await Promise.all([
			this.forms?.retargetAll(target),
			this.bindings?.retarget(target),
			this.mcp?.retarget(target),
		]);
	}

	// The save bar (ADR-095) saves every changed form and the two cards (ADR-096, ADR-097).
	protected async saveAll(): Promise<void> {
		await this.forms?.saveAll();
		await this.bindings?.save();
		await this.mcp?.save();
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
					mcp={this.mcp?.form()}
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
