import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	type FrontendApplicationContribution,
	FrontendApplicationContribution as FrontendApplicationContributionId,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteHomeWidget } from "./home-widget.js";

// The Home view's place in Theia: its commands (docs/13, Design system: every METE action is a
// command) and the side bar it opens in on the first start, Theia's left area for views.

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

@injectable()
export class MeteHomeContribution
	extends AbstractViewContribution<MeteHomeWidget>
	implements FrontendApplicationContribution
{
	constructor() {
		super({
			widgetId: MeteHomeWidget.ID,
			widgetName: nls.localize("mete/home/title", "METE"),
			defaultWidgetOptions: { area: "left" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_HOME_COMMAND, {
			execute: () => this.openView({ activate: true, reveal: true }),
		});
		commands.registerCommand(REFRESH_HOME_COMMAND, {
			execute: async () => (await this.openView({ reveal: true })).refresh(),
		});
	}

	/** Puts the Home view in the side bar of a fresh layout. */
	async initializeLayout(): Promise<void> {
		await this.openView();
	}
}

/** Binds the Home view, its factory and its contribution into the frontend container. */
export const bindHome = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteHomeContribution);
	bind(FrontendApplicationContributionId).toService(MeteHomeContribution);
	bind(MeteHomeWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteHomeWidget.ID,
			createWidget: () => ctx.container.get(MeteHomeWidget),
		}))
		.inSingletonScope();
};
