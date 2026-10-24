import "reflect-metadata";
import type { ApprovalInput } from "@mete/contracts";
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
import { MeteApprovalContribution } from "../src/application/approval-commands.js";
import {
	type DaemonFailure,
	MeteDaemonService,
	type StatusRuns,
} from "../src/domain/status-service.js";

// The inbox's commands in a real inversify container; Theia's services and the daemon are fakes.
// The workspace service module loads lumino, which needs a DOM; only its identity is used here.
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class WorkspaceService {},
}));

type Done = { ok: true; value: null } | { ok: false; error: DaemonFailure };

const run = (id: string, goal: string, pauseReason: string) =>
	({
		id,
		workspaceId: "w",
		templateId: "duo",
		goal,
		status: "paused",
		pauseReason,
		autonomyLevel: 2,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: "2026-10-23T10:00:00.000Z",
	}) as StatusRuns[number];

const setup = (opts: {
	runs?: StatusRuns;
	feedback?: string;
	pick?: number;
	answer?: Done;
}) => {
	const info: string[] = [];
	const warn: string[] = [];
	const calls: { kind: string; runId: string; input?: ApprovalInput }[] = [];
	const picked: string[][] = [];
	const c = new Container();
	c.bind(MessageService).toConstantValue({
		info: async (m: string) => void info.push(m),
		warn: async (m: string) => void warn.push(m),
	} as unknown as MessageService);
	c.bind(WorkspaceService).toConstantValue({
		tryGetRoots: () => [{ resource: { path: { fsPath: () => "/w" } } }],
	} as unknown as WorkspaceService);
	c.bind(QuickInputService).toConstantValue({
		input: async () => opts.feedback,
		pick: async (items: { label: string }[]) => {
			picked.push(items.map((i) => i.label));
			return opts.pick === undefined ? undefined : items[opts.pick];
		},
	} as unknown as QuickInputService);
	const answer = opts.answer ?? { ok: true, value: null };
	c.bind(MeteDaemonService).toConstantValue({
		status: async () => ({ ok: true, value: opts.runs ?? [] }),
		approve: async (_dir: string, runId: string, input: ApprovalInput) => {
			calls.push({ kind: "approve", runId, input });
			return answer;
		},
		resume: async (_dir: string, runId: string) => {
			calls.push({ kind: "resume", runId });
			return answer;
		},
	});
	c.bind(MeteApprovalContribution).toSelf();
	const handlers = new Map<string, CommandHandler>();
	c.get(MeteApprovalContribution).registerCommands({
		registerCommand: (cmd: Command, h: CommandHandler) =>
			void handlers.set(cmd.id, h),
	} as unknown as CommandRegistry);
	const exec = (id: string, ...args: unknown[]) =>
		handlers.get(id)?.execute(...args);
	return { info, warn, calls, picked, exec };
};

describe("the approvals inbox commands", () => {
	it("approves, revises with feedback and resumes the run a Home button names", async () => {
		const t = setup({ feedback: " shorter, please " });
		await t.exec("mete.run.approve", "r1");
		await t.exec("mete.run.revise", "r1");
		await t.exec("mete.run.resume", "r1");
		expect(t.calls).toEqual([
			{ kind: "approve", runId: "r1", input: { decision: "approve" } },
			{
				kind: "approve",
				runId: "r1",
				input: { decision: "revise", feedback: "shorter, please" },
			},
			{ kind: "resume", runId: "r1" },
		]);
		expect(t.info).toEqual([
			"Approved; the run goes on.",
			"Sent back with your feedback.",
			"Resumed.",
		]);
	});

	it("revises with the feedback the Team panel's strip typed, without asking again (ADR-091)", async () => {
		const t = setup({ feedback: "never asked" });
		await t.exec("mete.run.revise", "r1", "  bigger dot  ");
		expect(t.calls).toEqual([
			{
				kind: "approve",
				runId: "r1",
				input: { decision: "revise", feedback: "bigger dot" },
			},
		]);
	});

	it("asks which run from the palette, among those that wait for you", async () => {
		const t = setup({
			runs: [
				run("a", "first", "approval"),
				run("b", "quota", "quota"),
				run("c", "second", "approval"),
			],
			pick: 1,
		});
		await t.exec("mete.run.approve");
		expect(t.picked).toEqual([["first", "second"]]);
		expect(t.calls[0]?.runId).toBe("c");
	});

	it("offers runs paused for quota or by the user to Resume only (ADR-059, ADR-061)", async () => {
		const t = setup({
			runs: [
				run("a", "first", "approval"),
				run("b", "spent", "quota"),
				run("u", "mine", "user"),
			],
			pick: 1,
		});
		await t.exec("mete.run.resume");
		expect(t.picked).toEqual([["first", "spent", "mine"]]);
		expect(t.calls).toEqual([{ kind: "resume", runId: "b" }]);
	});

	it("says when nothing waits, and gives up without feedback or a pick", async () => {
		const none = setup({ runs: [run("b", "quota", "quota")] });
		await none.exec("mete.run.approve");
		expect(none.info).toEqual(["No run waits for you."]);
		const noFeedback = setup({ feedback: "  " });
		await noFeedback.exec("mete.run.revise", "r1");
		const noPick = setup({ runs: [run("a", "first", "approval")] });
		await noPick.exec("mete.run.approve");
		expect([...noFeedback.calls, ...noPick.calls]).toEqual([]);
	});

	it("shows the engine's refusal", async () => {
		const t = setup({
			answer: {
				ok: false,
				error: {
					code: "refused",
					detail: "a single-agent run has no tasks to approve",
				},
			},
		});
		await t.exec("mete.run.approve", "r1");
		expect(t.warn).toEqual([
			"The METE daemon refused the request: a single\\-agent run has no tasks to approve",
		]);
	});
});
