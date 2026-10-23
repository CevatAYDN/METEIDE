import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { injectable, type interfaces } from "@theia/core/shared/inversify";
import { MeteAuditWidget } from "./audit-widget.js";

// The Audit log view's place in Theia: "METE: Open audit log" opens it in the main area (docs/13;
// ADR-053).

/** The palette entry "METE: Open audit log". */
export const OPEN_AUDIT_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.audit.open", category: "METE", label: "Open audit log" },
	"mete/audit/open",
	"mete/category",
);

@injectable()
export class MeteAuditContribution extends AbstractViewContribution<MeteAuditWidget> {
	constructor() {
		super({
			widgetId: MeteAuditWidget.ID,
			widgetName: nls.localize("mete/audit/title", "Audit log"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_AUDIT_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}
}

/** Binds the Audit log view, its factory and its contribution into the frontend container. */
export const bindAudit = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteAuditContribution);
	bind(MeteAuditWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteAuditWidget.ID,
			createWidget: () => ctx.container.get(MeteAuditWidget),
		}))
		.inSingletonScope();
};
