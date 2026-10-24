import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { nls } from "@theia/core/lib/common/nls";
import {
	QuickInputService,
	type QuickPickItem,
} from "@theia/core/lib/common/quick-pick-service";
import { inject, injectable } from "@theia/core/shared/inversify";
import { MeteDaemonService } from "../domain/status-service.js";
import { failureText, plain } from "./status-text.js";

// The first onboarding step (ADR-049): a provider key, set through `mete key set` in the backend.
// The rest of docs/13's wizard is the Welcome screen (ADR-088).

/** The palette entry "METE: Set provider key". */
export const SET_KEY_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.key.set", category: "METE", label: "Set provider key" },
	"mete/key/set",
	"mete/category",
);

type ProviderPick = QuickPickItem & { readonly providerId: string };

@injectable()
export class MeteKeyContribution implements CommandContribution {
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(SET_KEY_COMMAND, { execute: () => this.setKey() });
	}

	// The providers come from `mete key list`, so the desktop keeps no provider names of its own.
	protected async setKey(): Promise<void> {
		const keys = await this.daemon.keys();
		if (!keys.ok)
			return void this.messages.warn(failureText(keys.error, plain));
		const picks: ProviderPick[] = keys.value.map((k) => ({
			label: k.id,
			description: k.set
				? nls.localize("mete/key/hasKey", "key set")
				: nls.localize("mete/key/noKey", "no key"),
			providerId: k.id,
		}));
		const pick = await this.quick.pick(picks, {
			placeHolder: nls.localize("mete/key/which", "Which provider's key?"),
		});
		if (!pick) return;
		const key = (
			await this.quick.input({
				prompt: nls.localize(
					"mete/key/prompt",
					"API key for {0}",
					pick.providerId,
				),
				password: true,
				ignoreFocusLost: true,
			})
		)?.trim();
		if (!key) return;
		const r = await this.daemon.setKey(pick.providerId, key);
		if (r.ok)
			void this.messages.info(
				nls.localize("mete/key/saved", "Key saved; METE restarted to use it."),
			);
		else void this.messages.warn(failureText(r.error, plain));
	}
}
