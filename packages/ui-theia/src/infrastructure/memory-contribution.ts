import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteMemoryWidget } from "./memory-widget.js";

// The Memory screen's place in Theia: "METE: Open memory" opens it in the main area (docs/13,
// Knowledge; ADR-159).

/** The palette entry "METE: Open memory". */
export const OPEN_MEMORY_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.memory.open", category: "METE", label: "Open memory" },
	"mete/memory/open",
	"mete/category",
);

@injectable()
export class MeteMemoryContribution extends AbstractViewContribution<MeteMemoryWidget> {
	constructor() {
		super({
			widgetId: MeteMemoryWidget.ID,
			widgetName: nls.localize("mete/memory/title", "Memory"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_MEMORY_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}
}

/** Binds the Memory screen, its factory and its contribution into the frontend container. */
export const bindMemory = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteMemoryContribution);
	bind(MeteMemoryWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteMemoryWidget.ID,
			createWidget: () => ctx.container.get(MeteMemoryWidget),
		}))
		.inSingletonScope();
};
