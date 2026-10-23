import "reflect-metadata";
import {
	type Command,
	type CommandHandler,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import { Container } from "@theia/core/shared/inversify";
import { describe, expect, it } from "vitest";
import { MeteKeyContribution } from "../src/application/key-command.js";
import type { ProviderKey } from "../src/domain/provider-keys.js";
import {
	type DaemonFailure,
	MeteDaemonService,
} from "../src/domain/status-service.js";

// The command in a real inversify container; Theia's services and the backend are fakes.

type Done = { ok: true; value: null } | { ok: false; error: DaemonFailure };

const setup = (opts: { key?: string; pick?: number; saved?: Done }) => {
	const info: string[] = [];
	const warn: string[] = [];
	const picked: string[][] = [];
	const inputs: unknown[] = [];
	const set: [string, string][] = [];
	const providers: ProviderKey[] = [
		{ id: "nvidia", set: true },
		{ id: "openrouter", set: false },
	];
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		info: async (m: string) => void info.push(m),
		warn: async (m: string) => void warn.push(m),
	} as unknown as MessageService);
	c.bind(QuickInputService).toConstantValue({
		input: async (o: unknown) => {
			inputs.push(o);
			return opts.key;
		},
		pick: async (items: { label: string; description: string }[]) => {
			picked.push(items.map((i) => `${i.label}: ${i.description}`));
			return opts.pick === undefined ? undefined : items[opts.pick];
		},
	} as unknown as QuickInputService);
	c.bind(MeteDaemonService).toConstantValue({
		keys: async () => ({ ok: true, value: providers }),
		setKey: async (id: string, key: string) => {
			set.push([id, key]);
			return opts.saved ?? { ok: true, value: null };
		},
	});
	c.bind(MeteKeyContribution).toSelf();
	const handlers = new Map<string, CommandHandler>();
	c.get(MeteKeyContribution).registerCommands({
		registerCommand: (cmd: Command, h: CommandHandler) =>
			void handlers.set(cmd.id, h),
	} as unknown as CommandRegistry);
	return {
		info,
		warn,
		picked,
		inputs,
		set,
		run: () => handlers.get("mete.key.set")?.execute(),
	};
};

describe("METE: Set provider key", () => {
	it("offers the providers mete key list names and asks for the key in a masked field", async () => {
		const t = setup({ pick: 1, key: " sk-or-123 " });
		await t.run();
		expect(t.picked).toEqual([["nvidia: key set", "openrouter: no key"]]);
		expect(t.inputs).toEqual([
			expect.objectContaining({
				password: true,
				prompt: "API key for openrouter",
			}),
		]);
		expect(t.set).toEqual([["openrouter", "sk-or-123"]]);
		expect(t.info).toEqual(["Key saved; METE restarted to use it."]);
	});

	it("sets nothing when the pick or the key is left empty", async () => {
		const noPick = setup({});
		await noPick.run();
		const noKey = setup({ pick: 0, key: "  " });
		await noKey.run();
		expect([...noPick.set, ...noKey.set]).toEqual([]);
	});

	it("shows what mete key said when it refused", async () => {
		const t = setup({
			pick: 0,
			key: "k",
			saved: {
				ok: false,
				error: { code: "refused", detail: "keychain locked" },
			},
		});
		await t.run();
		expect(t.warn).toEqual([
			"The METE daemon refused the request: keychain locked",
		]);
	});
});
