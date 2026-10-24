import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteSettingsWidget } from "./settings-widget.js";

// The Settings screen's place in Theia: "METE: Show settings" opens it in the main area, a rare
// screen of ADR-078 (docs/13; ADR-081).

/** The palette entry "METE: Show settings". */
export const SHOW_SETTINGS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.settings.show", category: "METE", label: "Show settings" },
	"mete/settings/show",
	"mete/category",
);

@injectable()
export class MeteSettingsContribution extends AbstractViewContribution<MeteSettingsWidget> {
	constructor() {
		super({
			widgetId: MeteSettingsWidget.ID,
			widgetName: nls.localize("mete/settings/title", "Settings"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(SHOW_SETTINGS_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}
}

/** Binds the Settings screen, its factory and its contribution into the frontend container. */
export const bindSettings = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteSettingsContribution);
	bind(MeteSettingsWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteSettingsWidget.ID,
			createWidget: () => ctx.container.get(MeteSettingsWidget),
		}))
		.inSingletonScope();
};
