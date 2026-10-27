import "reflect-metadata";
import type {
	CommandHandler,
	CommandRegistry,
	MenuModelRegistry,
} from "@theia/core";
import { MessageService } from "@theia/core";
import { CommonMenus } from "@theia/core/lib/browser/common-menus";
import { Container } from "@theia/core/shared/inversify";
import { describe, expect, it } from "vitest";
import {
	CHECK_UPDATES_COMMAND,
	MeteUpdateContribution,
} from "../src/application/update-command.js";
import {
	MeteUpdateService,
	type UpdateState,
} from "../src/domain/update-service.js";

// "Check for Updates…" (ADR-137): the Help menu entry and the sentence each answer shows.

const setup = (state: UpdateState, click?: string) => {
	const shown: { level: string; text: string }[] = [];
	const installs: string[] = [];
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		showProgress: async () => ({ cancel: () => undefined }),
		info: async (text: string) => {
			shown.push({ level: "info", text });
			return click;
		},
		warn: async (text: string) => void shown.push({ level: "warn", text }),
	} as unknown as MessageService);
	c.bind(MeteUpdateService).toConstantValue({
		check: async () => state,
		install: async () => void installs.push("install"),
	});
	c.bind(MeteUpdateContribution).toSelf();
	const contribution = c.get(MeteUpdateContribution);
	let handler: CommandHandler | undefined;
	contribution.registerCommands({
		registerCommand: (_: unknown, h: CommandHandler) => {
			handler = h;
		},
	} as unknown as CommandRegistry);
	const run = async () => handler?.execute();
	return { contribution, shown, installs, run };
};

describe("Check for Updates…", () => {
	it("sits in the Help menu", () => {
		const menus: { path: string[]; id: string }[] = [];
		setup({ kind: "source" }).contribution.registerMenus({
			registerMenuAction: (path: string[], a: { commandId: string }) =>
				void menus.push({ path, id: a.commandId }),
		} as unknown as MenuModelRegistry);
		expect(menus).toEqual([
			{ path: CommonMenus.HELP, id: CHECK_UPDATES_COMMAND.id },
		]);
	});

	it("says plainly that no release has been published yet", async () => {
		const s = setup({ kind: "unpublished", current: "0.0.0" });
		await s.run();
		expect(s.shown).toEqual([
			{
				level: "info",
				text: "No METE IDE release has been published yet, so there is nothing to update to. This is version 0.0.0.",
			},
		]);
	});

	it("warns with the reason when the check fails", async () => {
		const s = setup({ kind: "failed", message: "getaddrinfo ENOTFOUND" });
		await s.run();
		expect(s.shown).toEqual([
			{
				level: "warn",
				text: "Could not check for updates: getaddrinfo ENOTFOUND",
			},
		]);
	});

	it("installs a downloaded release on Restart now", async () => {
		const s = setup({ kind: "ready", version: "0.2.0" }, "Restart now");
		await s.run();
		expect(s.shown[0]?.text).toBe(
			"METE IDE 0.2.0 is downloaded. Restart to install it.",
		);
		expect(s.installs).toEqual(["install"]);
	});

	it("leaves a downloaded release for later when the message is closed", async () => {
		const s = setup({ kind: "ready", version: "0.2.0" });
		await s.run();
		expect(s.installs).toEqual([]);
	});
});
