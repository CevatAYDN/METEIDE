import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteChangesWidget } from "./changes-widget.js";

// The Changes view's place in Theia: "METE: Open changes" opens it in the main area (docs/13;
// ADR-100).

/** The palette entry "METE: Open changes". */
export const OPEN_CHANGES_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.changes.open", category: "METE", label: "Open changes" },
	"mete/changes/open",
	"mete/category",
);

@injectable()
export class MeteChangesContribution extends AbstractViewContribution<MeteChangesWidget> {
	constructor() {
		super({
			widgetId: MeteChangesWidget.ID,
			widgetName: nls.localize("mete/changes/title", "Changes"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_CHANGES_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}
}

/** Binds the Changes view, its factory and its contribution into the frontend container. */
export const bindChanges = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteChangesContribution);
	bind(MeteChangesWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteChangesWidget.ID,
			createWidget: () => ctx.container.get(MeteChangesWidget),
		}))
		.inSingletonScope();
};
