import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteComposerWidget } from "./composer-widget.js";

// The run composer's place in Theia: "METE: Start run" opens the screen in the main area (docs/13,
// Run composer; ADR-071), and so does the Home view's Start run button.

/** The palette entry "METE: Start run". */
export const START_RUN_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.start", category: "METE", label: "Start run" },
	"mete/run/start",
	"mete/category",
);

@injectable()
export class MeteComposerContribution extends AbstractViewContribution<MeteComposerWidget> {
	constructor() {
		super({
			widgetId: MeteComposerWidget.ID,
			widgetName: nls.localize("mete/composer/title", "Start a run"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(START_RUN_COMMAND, {
			execute: async () => {
				const widget = await this.openView({ activate: true, reveal: true });
				await widget.refresh();
			},
		});
	}
}

/** Binds the run composer, its factory and its contribution into the frontend container. */
export const bindComposer = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteComposerContribution);
	bind(MeteComposerWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteComposerWidget.ID,
			createWidget: () => ctx.container.get(MeteComposerWidget),
		}))
		.inSingletonScope();
};
