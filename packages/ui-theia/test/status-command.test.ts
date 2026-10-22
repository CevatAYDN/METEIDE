import "reflect-metadata";
import {
	type Command,
	CommandContribution,
	type CommandHandler,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { Container } from "@theia/core/shared/inversify";
import { describe, expect, it } from "vitest";
import { MeteCommandContribution, STATUS_COMMAND } from "../src/index.js";
import frontendModule from "../src/infrastructure/frontend-module.js";

// The contribution runs in a real inversify container; Theia's message service and registry are fakes.

const container = () => {
	const shown: string[] = [];
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		info: async (m: string) => void shown.push(m),
	} as unknown as MessageService);
	c.load(frontendModule);
	return { c, shown };
};

describe("METE: Status", () => {
	it("is the palette entry METE: Status", () => {
		expect(STATUS_COMMAND).toMatchObject({
			id: "mete.status",
			category: "METE",
			label: "Status",
		});
	});

	it("is bound as a command contribution by the frontend module", () => {
		const { c } = container();
		const all = c.getAll(CommandContribution);
		expect(all).toHaveLength(1);
		expect(all[0]).toBeInstanceOf(MeteCommandContribution);
	});

	it("tells the user the daemon is not connected yet", async () => {
		const { c, shown } = container();
		const handlers = new Map<string, CommandHandler>();
		const registry = {
			registerCommand: (cmd: Command, h: CommandHandler) =>
				void handlers.set(cmd.id, h),
		} as unknown as CommandRegistry;
		for (const contribution of c.getAll<CommandContribution>(
			CommandContribution,
		))
			contribution.registerCommands(registry);
		await handlers.get("mete.status")?.execute();
		expect(shown).toEqual(["METE is not connected to the daemon yet."]);
	});
});
