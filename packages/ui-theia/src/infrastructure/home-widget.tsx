import { CommandService } from "@theia/core";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	postConstruct,
} from "@theia/core/shared/inversify";
// The design system of docs/13 on every METE panel (ADR-069); the bundle inlines its font.
import "../../style/mete.css";
import {
	QuotaSection,
	RunsSection,
	WaitingSection,
} from "../application/home-view.js";
import { SET_KEY_COMMAND } from "../application/key-command.js";
import { panelRoot } from "../application/panel-root.js";
import { WorkspacesSection } from "../application/workspaces-section.js";
import { START_RUN_COMMAND } from "./composer-contribution.js";
import { MeteHomeStore } from "./home-store.js";
import { OPEN_QUOTA_COMMAND } from "./quota-contribution.js";

// One section of the METE view (docs/13, Home; ADR-078), a part of its view container. Every
// section draws from the one store, so they show the same answer.

/** The sections, in the order the METE view stacks them. */
export const HOME_SECTIONS = [
	"waiting",
	"runs",
	"workspaces",
	"quota",
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** The widget id of a section. */
export const sectionId = (section: HomeSection) => `mete.home.${section}`;

const labelOf = (section: HomeSection) =>
	({
		waiting: nls.localize("mete/home/waiting", "Waiting for you"),
		runs: nls.localize("mete/home/runs", "Runs"),
		workspaces: nls.localize("mete/home/workspaces", "Workspaces"),
		quota: nls.localize("mete/home/quota", "Quota"),
	})[section];

@injectable()
export class MeteHomeSectionWidget extends ReactWidget {
	@inject(MeteHomeStore) protected readonly store!: MeteHomeStore;
	@inject(CommandService) protected readonly commands!: CommandService;
	@inject(ThemeService) protected readonly themes!: ThemeService;

	protected section: HomeSection = "runs";

	@postConstruct()
	protected init(): void {
		// The panel takes the tokens of Theia's theme (ADR-069): draw again on a change.
		this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
		this.toDispose.push(this.store.onDidChange(() => this.update()));
	}

	/** Makes this widget the given section; the factory calls it once, right after creating it. */
	asSection(section: HomeSection): this {
		this.section = section;
		this.id = sectionId(section);
		this.title.label = labelOf(section);
		this.update();
		return this;
	}

	protected run(id: string) {
		return void this.commands.executeCommand(id);
	}

	protected body() {
		const { model, workspaces } = this.store;
		const act = (a: Parameters<MeteHomeStore["act"]>[0], runId: string) =>
			void this.store.act(a, runId);
		if (this.section === "waiting")
			return <WaitingSection model={model} onAct={act} />;
		if (this.section === "workspaces")
			return (
				<WorkspacesSection
					workspaces={workspaces}
					onOpen={(uri) => this.store.openWorkspace(uri)}
				/>
			);
		if (this.section === "quota")
			return (
				<QuotaSection
					model={model}
					onOpenQuota={() => this.run(OPEN_QUOTA_COMMAND.id)}
				/>
			);
		return (
			<RunsSection
				model={model}
				onRefresh={() => void this.store.refresh()}
				onAct={act}
				onSetKey={() => this.run(SET_KEY_COMMAND.id)}
				onStart={() => this.run(START_RUN_COMMAND.id)}
			/>
		);
	}

	protected override render() {
		return (
			<div {...panelRoot(this.themes.getCurrentTheme().type)}>
				{this.body()}
			</div>
		);
	}
}
