import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteAssetsWidget } from "./assets-widget.js";

// The Assets view's place in Theia: "METE: Open assets" opens it in the main area (docs/13,
// Assets; ADR-114).

/** The palette entry "METE: Open assets". */
export const OPEN_ASSETS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.assets.open", category: "METE", label: "Open assets" },
	"mete/assets/open",
	"mete/category",
);

@injectable()
export class MeteAssetsContribution extends AbstractViewContribution<MeteAssetsWidget> {
	constructor() {
		super({
			widgetId: MeteAssetsWidget.ID,
			widgetName: nls.localize("mete/assets/title", "Assets"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_ASSETS_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}
}

/** Binds the Assets view, its factory and its contribution into the frontend container. */
export const bindAssets = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteAssetsContribution);
	bind(MeteAssetsWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteAssetsWidget.ID,
			createWidget: () => ctx.container.get(MeteAssetsWidget),
		}))
		.inSingletonScope();
};
