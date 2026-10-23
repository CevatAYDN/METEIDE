import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteQuotaWidget } from "./quota-widget.js";

// The Quota dashboard's place in Theia: "METE: Open quota dashboard" opens it in the main area
// (docs/13; ADR-054).

/** The palette entry "METE: Open quota dashboard". */
export const OPEN_QUOTA_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.quota.open", category: "METE", label: "Open quota dashboard" },
	"mete/quota/open",
	"mete/category",
);

@injectable()
export class MeteQuotaContribution extends AbstractViewContribution<MeteQuotaWidget> {
	constructor() {
		super({
			widgetId: MeteQuotaWidget.ID,
			widgetName: nls.localize("mete/quota/title", "Quota"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_QUOTA_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}
}

/** Binds the Quota dashboard, its factory and its contribution into the frontend container. */
export const bindQuota = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteQuotaContribution);
	bind(MeteQuotaWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteQuotaWidget.ID,
			createWidget: () => ctx.container.get(MeteQuotaWidget),
		}))
		.inSingletonScope();
};
