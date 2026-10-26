import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	codicon,
	type FrontendApplicationContribution,
	FrontendApplicationContribution as FrontendApplicationContributionId,
	ViewContainer,
	WidgetFactory,
	WidgetManager,
} from "@theia/core/lib/browser";
import {
	KeybindingContribution,
	type KeybindingRegistry,
} from "@theia/core/lib/browser/keybinding";
import { TabBarDecorator } from "@theia/core/lib/browser/shell/tab-bar-decorator";
import { StorageService } from "@theia/core/lib/browser/storage-service";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	type interfaces,
} from "@theia/core/shared/inversify";
import {
	HOME_SECTIONS,
	type HomeSection,
	sectionId,
} from "../domain/home-sections.js";
import { MeteHomeStore } from "./home-store.js";
import { MeteHomeSectionWidget } from "./home-widget.js";
import { METE_VIEW_ID, MeteInboxBadge } from "./inbox-badge.js";
import { followWaiting, SHOW_WAITING_COMMAND } from "./waiting.js";

// The METE view's place in Theia (ADR-078): a view container in the left area, as the Explorer is,
// whose collapsible sections are the parts below; its commands (docs/13, Design system: every METE
// action is a command); and the side bar it opens in on the first start.

/** The palette entry "METE: Open home". */
export const OPEN_HOME_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.home.open", category: "METE", label: "Open home" },
	"mete/home/open",
	"mete/category",
);

/** The palette entry "METE: Refresh home". */
export const REFRESH_HOME_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.home.refresh", category: "METE", label: "Refresh home" },
	"mete/home/refreshCommand",
	"mete/category",
);

/** Set once the METE view has been put in a restored layout. */
const PLACED_KEY = "mete.view.placed";

// Each part's share of the side bar's height, out of 100; Runs gets the most, as the list people
// steer from. Waiting for you shows only while a run waits and takes its share back each time.
const WAITING_WEIGHT = 20;
const PARTS: {
	readonly [S in HomeSection]: ViewContainer.Factory.WidgetOptions;
} = {
	waiting: { order: 0, weight: WAITING_WEIGHT, canHide: true },
	runs: { order: 1, weight: 45, canHide: false },
	workspaces: { order: 2, weight: 20, canHide: true },
	quota: { order: 3, weight: 15, canHide: true },
};

@injectable()
export class MeteHomeContribution
	extends AbstractViewContribution<MeteHomeSectionWidget>
	implements FrontendApplicationContribution, KeybindingContribution
{
	@inject(MeteHomeStore) protected readonly store!: MeteHomeStore;
	@inject(StorageService) protected readonly storage!: StorageService;

	constructor() {
		super({
			viewContainerId: METE_VIEW_ID,
			widgetId: sectionId("runs"),
			widgetName: nls.localize("mete/home/title", "METE"),
			// Above the Explorer (rank 100): the METE view is where a run is steered from.
			defaultWidgetOptions: { area: "left", rank: 50 },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_HOME_COMMAND, {
			execute: () => this.openView({ activate: true, reveal: true }),
		});
		commands.registerCommand(REFRESH_HOME_COMMAND, {
			execute: async () => {
				await this.openView({ reveal: true });
				await this.store.refresh();
			},
		});
		commands.registerCommand(SHOW_WAITING_COMMAND, {
			execute: () => this.showWaiting(),
		});
	}

	// Keyboard-first: every METE action is a command and reachable by keyboard (docs/13).
	override registerKeybindings(keybindings: KeybindingRegistry): void {
		keybindings.registerKeybinding({
			command: OPEN_HOME_COMMAND.id,
			keybinding: "ctrlcmd+shift+m",
		});
		keybindings.registerKeybinding({
			command: SHOW_WAITING_COMMAND.id,
			keybinding: "ctrlcmd+shift+a",
		});
	}

	// Opens the METE view on Waiting for you, also when the user had hidden or collapsed it.
	protected async showWaiting(): Promise<void> {
		await this.openView({ activate: true, reveal: true });
		const container = await this.widgetManager.getWidget(METE_VIEW_ID);
		const waiting = await this.widgetManager.getWidget(sectionId("waiting"));
		if (!(container instanceof ViewContainer) || !waiting) return;
		const part = container.getPartFor(waiting);
		part?.setHidden(false);
		if (part) part.collapsed = false;
	}

	/** Puts the METE view in the side bar of a fresh layout. */
	async initializeLayout(): Promise<void> {
		await this.openView();
	}

	// A layout saved before ADR-078 held the Home widget, which no longer exists, so Theia restores it
	// without a METE view: put the view in the side bar once; after that the user's layout decides.
	async onDidInitializeLayout(): Promise<void> {
		if (await this.storage.getData<boolean>(PLACED_KEY)) return;
		await this.storage.setData(PLACED_KEY, true);
		await this.openView({ reveal: true });
	}
}

// The view container and its parts, as Theia's navigator builds the Explorer.
const containerFactory = (ctx: interfaces.Context): WidgetFactory => ({
	id: METE_VIEW_ID,
	createWidget: async () => {
		const container = ctx.container.get<ViewContainer.Factory>(
			ViewContainer.Factory,
		)({ id: METE_VIEW_ID });
		container.setTitleOptions({
			label: nls.localize("mete/home/title", "METE"),
			iconClass: codicon("home"),
			closeable: true,
		});
		const widgets = ctx.container.get(WidgetManager);
		for (const s of HOME_SECTIONS)
			container.addWidget(
				await widgets.getOrCreateWidget(sectionId(s)),
				PARTS[s],
			);
		const waiting = await widgets.getOrCreateWidget(sectionId("waiting"));
		followWaiting(
			container,
			waiting,
			ctx.container.get(MeteHomeStore),
			WAITING_WEIGHT / 100,
		);
		return container;
	},
});

/** Binds the METE view, its sections, their store and its contribution into the frontend container. */
export const bindHome = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteHomeContribution);
	bind(FrontendApplicationContributionId).toService(MeteHomeContribution);
	bind(KeybindingContribution).toService(MeteHomeContribution);
	bind(MeteHomeStore).toSelf().inSingletonScope();
	bind(MeteHomeSectionWidget).toSelf();
	bind(MeteInboxBadge).toSelf().inSingletonScope();
	bind(TabBarDecorator).toService(MeteInboxBadge);
	bind(WidgetFactory).toDynamicValue(containerFactory).inSingletonScope();
	for (const s of HOME_SECTIONS)
		bind(WidgetFactory)
			.toDynamicValue((ctx) => ({
				id: sectionId(s),
				createWidget: () =>
					ctx.container.get(MeteHomeSectionWidget).asSection(s),
			}))
			.inSingletonScope();
};
