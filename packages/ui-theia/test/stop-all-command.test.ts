import "reflect-metadata";
import type { Command, CommandHandler, CommandRegistry } from "@theia/core";
import { MessageService } from "@theia/core";
import type { KeybindingRegistry } from "@theia/core/lib/browser/keybinding";
import {
	StatusBar,
	type StatusBarEntry,
} from "@theia/core/lib/browser/status-bar/status-bar-types";
import { Container } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { describe, expect, it, vi } from "vitest";
import {
	MeteStopAllContribution,
	MeteStopAllStatusBar,
	STOP_ALL_COMMAND,
} from "../src/application/stop-all-command.js";
import {
	type DaemonFailure,
	MeteDaemonService,
} from "../src/domain/status-service.js";

// The kill switch of SECURITY.md (ADR-065): the command, its key and its status bar button.
// The workspace service loads lumino, which needs a DOM; only its identity is used here.
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class WorkspaceService {},
}));

type Reply =
	| { ok: true; value: { cancelled: string[] } }
	| { ok: false; error: DaemonFailure };

const setup = (folders: string[], reply: Reply) => {
	const info: string[] = [];
	const warn: string[] = [];
	const asked: string[] = [];
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		info: async (m: string) => void info.push(m),
		warn: async (m: string) => void warn.push(m),
	} as unknown as MessageService);
	c.bind(WorkspaceService).toConstantValue({
		tryGetRoots: () =>
			folders.map((f) => ({ resource: { path: { fsPath: () => f } } })),
	} as unknown as WorkspaceService);
	c.bind(MeteDaemonService).toConstantValue({
		stopAll: async (dir: string) => {
			asked.push(dir);
			return reply;
		},
	});
	c.bind(MeteStopAllContribution).toSelf();
	const handlers = new Map<string, CommandHandler>();
	c.get(MeteStopAllContribution).registerCommands({
		registerCommand: (cmd: Command, h: CommandHandler) =>
			void handlers.set(cmd.id, h),
	} as unknown as CommandRegistry);
	return {
		c,
		info,
		warn,
		asked,
		execute: () => handlers.get("mete.stopAll")?.execute(),
	};
};

describe("METE: Stop all", () => {
	it("cancels the runs of the open folder at once and says how many", async () => {
		expect(STOP_ALL_COMMAND).toMatchObject({
			id: "mete.stopAll",
			category: "METE",
			label: "Stop all",
		});
		const two = setup(["/w", "/other"], {
			ok: true,
			value: { cancelled: [crypto.randomUUID(), crypto.randomUUID()] },
		});
		await two.execute();
		expect(two.asked).toEqual(["/w"]);
		expect(two.info).toEqual(["Stop all cancelled 2 runs."]);
		const one = setup(["/w"], {
			ok: true,
			value: { cancelled: [crypto.randomUUID()] },
		});
		await one.execute();
		expect(one.info).toEqual(["Stop all cancelled 1 run."]);
		const none = setup(["/w"], { ok: true, value: { cancelled: [] } });
		await none.execute();
		expect(none.info).toEqual([
			"No run was going on; Stop all cancelled none.",
		]);
	});

	it("asks for a folder first, and names why the daemon cancelled nothing", async () => {
		const nofolder = setup([], { ok: true, value: { cancelled: [] } });
		await nofolder.execute();
		expect(nofolder.asked).toEqual([]);
		expect(nofolder.info).toEqual([
			"Open a folder first: METE works on one folder at a time.",
		]);
		const failed = setup(["/w"], {
			ok: false,
			error: { code: "not_ready", detail: "no key" },
		});
		await failed.execute();
		expect(failed.warn).toEqual(["METE is not ready yet: no key"]);
	});

	it("binds Ctrl+Shift+. and shows a Stop all button at the left of the status bar", () => {
		const { c } = setup([], { ok: true, value: { cancelled: [] } });
		const keys: unknown[] = [];
		c.get(MeteStopAllContribution).registerKeybindings({
			registerKeybinding: (k: unknown) => void keys.push(k),
		} as unknown as KeybindingRegistry);
		expect(keys).toEqual([
			{ command: "mete.stopAll", keybinding: "ctrlcmd+shift+." },
		]);
		const entries = new Map<string, StatusBarEntry>();
		c.bind(StatusBar).toConstantValue({
			setElement: async (id: string, e: StatusBarEntry) =>
				void entries.set(id, e),
		} as unknown as StatusBar);
		c.bind(MeteStopAllStatusBar).toSelf();
		c.get(MeteStopAllStatusBar).onStart();
		expect(entries.get("mete.stopAll")).toMatchObject({
			text: "$(debug-stop) Stop all",
			alignment: 0,
			command: "mete.stopAll",
		});
	});
});
