import "reflect-metadata";
import type { RunStart } from "@mete/contracts";
import {
	type Command,
	type CommandHandler,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import { Container } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { describe, expect, it, vi } from "vitest";
import { MeteStartRunContribution } from "../src/application/start-run-command.js";
import {
	type DaemonFailure,
	MeteDaemonService,
} from "../src/domain/status-service.js";

// The command in a real inversify container; Theia's services and the daemon are fakes.
// The workspace service module loads lumino, which needs a DOM; only its identity is used here.
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class WorkspaceService {},
}));

type Reply =
	| { ok: true; value: { runId: string } }
	| { ok: false; error: DaemonFailure };

const UNSURE: Reply = {
	ok: false,
	error: {
		code: "choose_template",
		detail: "the router is unsure",
		suggestions: ["research", "web-dev"],
	},
};
const STARTED: Reply = { ok: true, value: { runId: "r1" } };
const TEMPLATES = {
	ok: true as const,
	value: {
		templates: [
			{
				id: "game-studio",
				name: "Game studio",
				description: "Idea to playable prototype",
			},
			{ id: "web-dev", name: "Web development" },
		],
	},
};
const LISTED = [
	"Let METE choose",
	"Game studio",
	"Web development",
	"Single agent",
];

const setup = (opts: {
	folders: string[];
	goal: string | undefined;
	replies: Reply[];
	/** Answers each pick in turn; a pick left without an answer takes the first item. */
	picks?: ((labels: string[]) => number | undefined)[];
	templates?: unknown;
}) => {
	const info: string[] = [];
	const warn: string[] = [];
	const asked: RunStart[] = [];
	const picked: string[][] = [];
	const progress = { shown: 0, cancelled: 0 };
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		info: async (m: string) => void info.push(m),
		showProgress: async () => {
			progress.shown += 1;
			return {
				cancel: () => {
					progress.cancelled += 1;
				},
			};
		},
		warn: async (m: string) => void warn.push(m),
	} as unknown as MessageService);
	c.bind(WorkspaceService).toConstantValue({
		tryGetRoots: () =>
			opts.folders.map((f) => ({ resource: { path: { fsPath: () => f } } })),
	} as unknown as WorkspaceService);
	c.bind(QuickInputService).toConstantValue({
		input: async () => opts.goal,
		pick: async (items: { label: string }[]) => {
			picked.push(items.map((i) => i.label));
			const answer = opts.picks?.shift() ?? (() => 0);
			const i = answer(items.map((x) => x.label));
			return i === undefined ? undefined : items[i];
		},
	} as unknown as QuickInputService);
	c.bind(MeteDaemonService).toConstantValue({
		templates: async () => opts.templates ?? TEMPLATES,
		startRun: async (_dir: string, req: RunStart) => {
			asked.push(req);
			return opts.replies.shift();
		},
	});
	c.bind(MeteStartRunContribution).toSelf();
	const handlers = new Map<string, CommandHandler>();
	c.get(MeteStartRunContribution).registerCommands({
		registerCommand: (cmd: Command, h: CommandHandler) =>
			void handlers.set(cmd.id, h),
	} as unknown as CommandRegistry);
	return {
		info,
		warn,
		asked,
		picked,
		progress,
		run: () => handlers.get("mete.run.start")?.execute(),
	};
};

describe("METE: Start run", () => {
	it("starts a run with the goal typed in and says so", async () => {
		const t = setup({
			folders: ["/w"],
			goal: "  fix the bug ",
			replies: [STARTED],
		});
		await t.run();
		// METE chooses unless a template is picked (ADR-058).
		expect(t.picked).toEqual([LISTED]);
		expect(t.asked).toEqual([{ goal: "fix the bug" }]);
		expect(t.info).toEqual(["Run started: r1"]);
	});

	it("starts the template picked from the list, or a single agent, without asking the router", async () => {
		const game = setup({
			folders: ["/w"],
			goal: "g",
			replies: [STARTED],
			picks: [(labels) => labels.indexOf("Game studio")],
		});
		await game.run();
		expect(game.asked).toEqual([{ goal: "g", templateId: "game-studio" }]);
		const single = setup({
			folders: ["/w"],
			goal: "g",
			replies: [STARTED],
			picks: [(labels) => labels.indexOf("Single agent")],
		});
		await single.run();
		expect(single.asked).toEqual([{ goal: "g", templateId: null }]);
		// Without the list (an older or failing daemon) METE chooses, as before.
		const failing = setup({
			folders: ["/w"],
			goal: "g",
			replies: [STARTED],
			templates: { ok: false, error: { code: "stopped", detail: "x" } },
		});
		await failing.run();
		expect(failing.picked).toEqual([["Let METE choose", "Single agent"]]);
		expect(failing.asked).toEqual([{ goal: "g" }]);
	});

	it("asks for a team when the router is unsure and starts again with the one picked", async () => {
		const single = setup({
			folders: ["/w"],
			goal: "g",
			replies: [UNSURE, STARTED],
			picks: [() => 0, (labels) => labels.indexOf("Single agent")],
		});
		await single.run();
		expect(single.picked).toEqual([
			LISTED,
			["research", "web-dev", "Single agent"],
		]);
		expect(single.asked).toEqual([
			{ goal: "g" },
			{ goal: "g", templateId: null },
		]);
		// Each start shows that METE is busy while the router works, and clears it after.
		expect(single.progress).toEqual({ shown: 2, cancelled: 2 });
		const team = setup({
			folders: ["/w"],
			goal: "g",
			replies: [UNSURE, STARTED],
			picks: [() => 0, () => 1],
		});
		await team.run();
		expect(team.asked.at(-1)).toEqual({ goal: "g", templateId: "web-dev" });
	});

	it("does nothing more when the goal or the team pick is left empty", async () => {
		const empty = setup({ folders: ["/w"], goal: "   ", replies: [] });
		await empty.run();
		expect(empty.asked).toEqual([]);
		const cancelled = setup({
			folders: ["/w"],
			goal: "g",
			replies: [UNSURE],
			picks: [() => 0, () => undefined],
		});
		await cancelled.run();
		expect(cancelled.asked).toHaveLength(1);
		// Leaving the template list empty starts nothing.
		const left = setup({
			folders: ["/w"],
			goal: "g",
			replies: [],
			picks: [() => undefined],
		});
		await left.run();
		expect(left.asked).toEqual([]);
		expect(cancelled.info).toEqual([]);
		expect(cancelled.warn).toEqual([]);
	});

	it("asks for a folder first, and shows a refusal with its Markdown escaped", async () => {
		const none = setup({ folders: [], goal: "g", replies: [] });
		await none.run();
		expect(none.info).toEqual([
			"Open a folder first: METE works on one folder at a time.",
		]);
		const refused = setup({
			folders: ["/w"],
			goal: "g",
			replies: [{ ok: false, error: { code: "not_ready", detail: "no_key" } }],
		});
		await refused.run();
		expect(refused.warn).toEqual(["METE is not ready yet: no\\_key"]);
	});
});
