import { Command, type CommandRegistry } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	type FrontendApplicationContribution,
	FrontendApplicationContribution as FrontendApplicationContributionId,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import {
	inject,
	injectable,
	type interfaces,
} from "@theia/core/shared/inversify";
import { needsWelcome } from "../application/welcome-view.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { MeteWelcomeWidget } from "./welcome-widget.js";

// The Welcome screen's place in Theia (ADR-088): "METE: Welcome" opens it, and it opens by itself
// once the layout is up while no model provider has a key, after the Team panel of a fresh layout.

/** The palette entry "METE: Welcome". */
export const OPEN_WELCOME_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.welcome.open", category: "METE", label: "Welcome" },
	"mete/welcome/open",
	"mete/category",
);

@injectable()
export class MeteWelcomeContribution
	extends AbstractViewContribution<MeteWelcomeWidget>
	implements FrontendApplicationContribution
{
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;

	constructor() {
		super({
			widgetId: MeteWelcomeWidget.ID,
			widgetName: nls.localize("mete/welcome/open", "Welcome"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_WELCOME_COMMAND, {
			execute: async () =>
				(await this.openView({ activate: true, reveal: true })).refresh(),
		});
	}

	// A failed key list (no CLI, a locked keychain) opens nothing: only a known empty list does.
	async onDidInitializeLayout(): Promise<void> {
		const keys = await this.daemon.keys();
		if (keys.ok && needsWelcome(keys.value))
			await this.openView({ activate: true, reveal: true });
	}
}

/** Binds the Welcome screen, its factory and its contribution into the frontend container. */
export const bindWelcome = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteWelcomeContribution);
	bind(FrontendApplicationContributionId).toService(MeteWelcomeContribution);
	bind(MeteWelcomeWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteWelcomeWidget.ID,
			createWidget: () => ctx.container.get(MeteWelcomeWidget),
		}))
		.inSingletonScope();
};
