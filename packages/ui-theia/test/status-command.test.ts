import "reflect-metadata";
import {
	type Command,
	CommandContribution,
	type CommandHandler,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import { Container } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { describe, expect, it, vi } from "vitest";
import { QUOTA_COMMAND } from "../src/application/status-command.js";
import {
	type DaemonFailure,
	MeteDaemonService,
	type StatusRuns,
} from "../src/domain/status-service.js";
import { MeteCommandContribution, STATUS_COMMAND } from "../src/index.js";
import frontendModule from "../src/infrastructure/frontend-module.js";

// The contribution runs in a real inversify container; Theia's services and the daemon are fakes.
// These two Theia browser modules load lumino, which needs a DOM; only their identity is used here,
// and the window check (README) covers the real wiring.
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class WorkspaceService {},
}));
// The Home view's bindings load lumino widgets; test/home-view.test.ts covers the view itself.
vi.mock("../src/infrastructure/home-contribution.js", () => ({
	bindHome: () => {},
}));
// The Board view's bindings load lumino too; test/board-view.test.ts covers the view.
vi.mock("../src/infrastructure/board-contribution.js", () => ({
	bindBoard: () => {},
}));
// The Audit log view loads lumino and the filesystem browser too; test/audit-view.test.ts covers it.
vi.mock("../src/infrastructure/audit-contribution.js", () => ({
	bindAudit: () => {},
}));
vi.mock("../src/infrastructure/quota-contribution.js", () => ({
	bindQuota: () => {},
}));
// Stop all's keybinding and status bar types load lumino too; test/stop-all-command.test.ts covers it.
vi.mock("../src/infrastructure/stop-all-contribution.js", () => ({
	bindStopAll: () => {},
}));
// The METE menu and the status bar's waiting count load lumino too; the window check covers them.
vi.mock("../src/infrastructure/shell-contribution.js", () => ({
	bindShell: () => {},
}));
// The team editor's screen loads lumino too; test/team-editor-view.test.ts covers the screen.
vi.mock("../src/infrastructure/team-editor-contribution.js", () => ({
	bindTeamEditor: () => {},
}));
// Opening an artifact goes through Theia's browser openers; test/artifact.test.ts covers the choice.
vi.mock("../src/infrastructure/artifact-command.js", () => ({
	MeteArtifactContribution: class MeteArtifactContribution {
		registerCommands() {}
	},
}));
vi.mock(
	"@theia/core/lib/browser/messaging/service-connection-provider",
	() => ({
		ServiceConnectionProvider: { createProxy: () => ({}) },
	}),
);

type Reply =
	| { ok: true; value: StatusRuns }
	| { ok: false; error: DaemonFailure };

const run = (status: string, goal: string) =>
	({
		id: crypto.randomUUID(),
		workspaceId: crypto.randomUUID(),
		templateId: null,
		goal,
		status,
		autonomyLevel: 2,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: "2026-10-23T10:00:00.000Z",
	}) as StatusRuns[number];

const setup = (folders: string[], reply: Reply) => {
	const info: string[] = [];
	const warn: string[] = [];
	const asked: string[] = [];
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		info: async (m: string) => void info.push(m),
		warn: async (m: string) => void warn.push(m),
	} as unknown as MessageService);
	// The frontend module also binds the approval and key commands, which ask through the quick input.
	c.bind(QuickInputService).toConstantValue({} as unknown as QuickInputService);
	c.bind(WorkspaceService).toConstantValue({
		tryGetRoots: () =>
			folders.map((f) => ({ resource: { path: { fsPath: () => f } } })),
	} as unknown as WorkspaceService);
	c.load(frontendModule);
	c.rebind(MeteDaemonService).toConstantValue({
		status: async (dir: string) => {
			asked.push(dir);
			return reply;
		},
		quota: async (dir: string) => {
			asked.push(dir);
			return reply.ok
				? {
						ok: true,
						value: {
							providers: [
								{ id: "groq", state: "ready" },
								{ id: "my_llm", state: "inactive" },
							],
						},
					}
				: reply;
		},
	});
	const handlers = new Map<string, CommandHandler>();
	const registry = {
		registerCommand: (cmd: Command, h: CommandHandler) =>
			void handlers.set(cmd.id, h),
	} as unknown as CommandRegistry;
	for (const contribution of c.getAll<CommandContribution>(CommandContribution))
		contribution.registerCommands(registry);
	return {
		c,
		info,
		warn,
		asked,
		execute: (id = "mete.status") => handlers.get(id)?.execute(),
	};
};

describe("METE: Quota", () => {
	it("says each provider's state for the first folder, with ids escaped for Markdown", async () => {
		expect(QUOTA_COMMAND).toMatchObject({
			id: "mete.quota",
			category: "METE",
			label: "Quota",
		});
		const t = setup(["/w"], { ok: true, value: [] });
		await t.execute("mete.quota");
		expect(t.asked).toEqual(["/w"]);
		expect(t.info).toEqual([
			String.raw`Providers: groq: ready; my\_llm: not active; the log says why`,
		]);
	});

	it("asks for a folder first, and names why the daemon gave no states", async () => {
		const none = setup([], { ok: true, value: [] });
		await none.execute("mete.quota");
		expect(none.asked).toEqual([]);
		expect(none.info).toEqual([
			"Open a folder first: METE works on one folder at a time.",
		]);
		const failed = setup(["/w"], {
			ok: false,
			error: { code: "not_ready", detail: "no key" },
		});
		await failed.execute("mete.quota");
		expect(failed.warn).toEqual(["METE is not ready yet: no key"]);
	});
});

describe("METE: Status", () => {
	it("is the palette entry METE: Status, bound by the frontend module", () => {
		expect(STATUS_COMMAND).toMatchObject({
			id: "mete.status",
			category: "METE",
			label: "Status",
		});
		const { c } = setup([], { ok: true, value: [] });
		expect(c.getAll(CommandContribution)[0]).toBeInstanceOf(
			MeteCommandContribution,
		);
	});

	it("asks to open a folder first and does not start a daemon without one", async () => {
		const t = setup([], { ok: true, value: [] });
		await t.execute();
		expect(t.info).toEqual([
			"Open a folder first: METE works on one folder at a time.",
		]);
		expect(t.asked).toEqual([]);
	});

	it("counts the runs of the first folder", async () => {
		const empty = setup(["/work/a"], { ok: true, value: [] });
		await empty.execute();
		expect(empty.asked).toEqual(["/work/a"]);
		expect(empty.info).toEqual(["No runs in this folder yet."]);

		const two = setup(["/work/a", "/work/b"], {
			ok: true,
			value: [run("paused", "fix the bug"), run("completed", "write notes")],
		});
		await two.execute();
		expect(two.info).toEqual([
			'2 run(s) in this folder: paused "fix the bug"; completed "write notes"',
		]);

		const seven = setup(["/w"], {
			ok: true,
			value: Array.from({ length: 7 }, (_, i) => run("completed", `g${i}`)),
		});
		await seven.execute();
		expect(seven.info[0]).toMatch(
			/"g4"; and 2 more; the Home panel lists them all$/,
		);
	});

	it("escapes Markdown in what came from outside, because Theia renders messages as Markdown", async () => {
		const lock = String.raw`C:\Users\me\.mete\cache\run.lock`;
		const failed = setup(["/w"], {
			ok: false,
			error: { code: "stopped", detail: `delete ${lock} (a_b)` },
		});
		await failed.execute();
		expect(failed.warn).toEqual([
			String.raw`The METE daemon stopped: delete C:\\Users\\me\\\.mete\\cache\\run\.lock \(a\_b\)`,
		]);
		const goal = setup(["/w"], {
			ok: true,
			value: [run("paused", "fix *the* bug")],
		});
		await goal.execute();
		expect(goal.info).toEqual([
			String.raw`1 run(s) in this folder: paused "fix \*the\* bug"`,
		]);
	});

	it("names each reason the daemon gave no runs, with what it reported", async () => {
		const texts: Record<DaemonFailure["code"], string> = {
			not_ready: "METE is not ready yet: no provider key",
			cli: "The mete command failed: no provider key",
			choose_template: "Choose a team for this goal: no provider key",
			stopped: "The METE daemon stopped: exit code 1: no provider key",
			blocked:
				"The METE daemon keeps stopping, so METE does not start it again for now: exit code 1: no provider key",
			refused: "The METE daemon refused the request: no provider key",
			protocol:
				"The METE daemon sent an answer METE does not understand: no provider key",
		};
		for (const [code, text] of Object.entries(texts)) {
			const detail =
				code === "stopped" || code === "blocked"
					? "exit code 1: no provider key"
					: "no provider key";
			const t = setup(["/w"], {
				ok: false,
				error: { code: code as DaemonFailure["code"], detail },
			});
			await t.execute();
			expect(t.warn).toEqual([text]);
		}
	});
});
