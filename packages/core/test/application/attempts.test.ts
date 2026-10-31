import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JUDGE_CANDIDATE_CHARS } from "../../src/defaults.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import {
	engineHarness,
	reply,
	type Script,
	type Tool,
} from "../helpers/engine.js";

// Best-of-N attempts (ADR-162): a writing task tries twice, each attempt with its own agent and
// worktree; its checks choose the attempt that goes on.
const BEST = (extra = "") => `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: best, name: Best, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [fs.write@1] }
  - { id: helper, name: Researcher, goal: Find answers, tier: fast, capabilities: [] }
tasks:
  - { id: build, role: dev, title: Build, guardrail: { schema: research-report@1, max_retries: 0 }, attempts: { n: 2, distinct_families: false, judge_tier: reasoning }${extra} }
`;

const report = (title: string) =>
	JSON.stringify({
		title,
		summary: "S",
		findings: [{ claim: "C", sourceIds: ["s1"] }],
		sources: [{ id: "s1", url: "https://example.com", title: "E" }],
	});
const REPORT = report("T");
const fenced = (json: string) => reply(`\`\`\`json\n${json}\n\`\`\``);
const PASSES = fenced(REPORT);

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-attempts-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
});
afterEach(() => rm(root, { recursive: true, force: true }));

// A vcs.git@2 that gives each worktree a folder of its own and records what it was asked; its
// status and diff name the worktree they were asked in.
const fakeVcs = (
	diff: (cwd: string) => string | Promise<string> = (cwd) => `diff in ${cwd}`,
) => {
	const calls: { op: string; taskId?: string }[] = [];
	const read = async (op: string, cwd: string) =>
		op === "diff"
			? ok({ op, diff: await diff(cwd) })
			: ok({
					op,
					branch: "b",
					files: [{ path: `${cwd}/index.html`, index: "?", worktree: "?" }],
				});
	const run: Tool = async (input, ctx) => {
		const i = input as { op: string; taskId?: string };
		calls.push(i);
		if (i.op === "status" || i.op === "diff") return read(i.op, ctx.cwd ?? "");
		if (i.op === "worktree.create")
			return ok({ op: i.op, path: `/wt/${i.taskId}`, branch: "b", sha: "s" });
		if (i.op === "merge") return ok({ op: "merge", sha: "m" });
		if (i.op === "worktree.remove") return ok({ op: i.op, removed: true });
		return ok({
			op: "checkpoint.create",
			ref: "refs/mete/checkpoints/r/1",
			sha: "s",
		});
	};
	const ids = (op: string) =>
		calls.filter((c) => c.op === op).map((c) => c.taskId);
	return { run, ids };
};

// An engine over the best template's workspace; with `db`, as after a restart.
const harness = (
	vcs: ReturnType<typeof fakeVcs>,
	scripts: Script[],
	db?: ReturnType<typeof engineHarness>["db"],
) =>
	engineHarness({
		scripts,
		templates,
		...(db ? { db } : {}),
		tools: [
			["fs.write@1", async () => ok({ bytes: 1 })],
			["vcs.git@2", vcs.run],
		],
	});

const run = async (
	extra: string,
	scripts: Script[],
	diff?: (cwd: string) => string | Promise<string>,
) => {
	await writeFile(join(templates.builtIn, "best.yaml"), BEST(extra));
	const vcs = fakeVcs(diff);
	const h = harness(vcs, scripts);
	const r = await h.engine.start({ goal: "a page", templateId: "best" });
	if (!r.ok) throw new Error(r.error.message);
	const runId = r.value.runId;
	const settled = (status: string) =>
		vi.waitFor(() => {
			const v = h.engine.status(runId);
			expect(v.ok && v.value[0]?.status).toBe(status);
		});
	const payloads = (type: string) =>
		h.events.filter((e) => e.type === type).map((e) => e.payload);
	return { h, vcs, runId, settled, payloads };
};

describe("best-of-N attempts (ADR-162)", () => {
	it("spends an attempt whose repairs ran out and submits the next one, chosen by its checks", async () => {
		const { h, vcs, settled, payloads } = await run("", [
			reply("notes"),
			PASSES,
		]);
		await settled("completed");
		const attempts = payloads("agent.created").map(
			(p) => (p as { attempt?: unknown }).attempt,
		);
		expect(attempts).toEqual([
			{ k: 1, n: 2 },
			{ k: 2, n: 2 },
		]);
		expect(payloads("task.attempt.chosen")).toEqual([
			{ attempt: 2, of: 2, by: "checks" },
		]);
		expect(payloads("task.status.changed")).toEqual([
			{ from: "todo", to: "in_progress" },
			{ from: "in_progress", to: "submitted" },
			{ from: "submitted", to: "approved" },
		]);
		const [first, second] = vcs.ids("worktree.create");
		expect(first).toBe(h.events.find((e) => e.taskId)?.taskId);
		expect(second).not.toBe(first);
		expect(vcs.ids("merge")).toEqual([second]);
		expect(vcs.ids("worktree.remove")).toEqual([first, second]);
		expect(h.events.at(-1)?.payload).toEqual({ summary: REPORT });
	});

	it("goes on with an earlier attempt when a later one fails, in its own worktree and words", async () => {
		const { h, vcs, settled, payloads } = await run("", [
			PASSES,
			reply("notes"),
		]);
		await settled("completed");
		// The second attempt opens afresh: nothing of the first one's work.
		expect(h.requests[1]?.messages.some((m) => m.role === "assistant")).toBe(
			false,
		);
		expect(payloads("task.attempt.chosen")).toEqual([
			{ attempt: 1, of: 2, by: "checks" },
		]);
		const [first, second] = vcs.ids("worktree.create");
		expect(vcs.ids("merge")).toEqual([first]);
		expect(vcs.ids("worktree.remove")).toEqual([second, first]);
		expect(h.events.at(-1)?.payload).toEqual({ summary: REPORT });
	});

	it("blocks the task with the last attempt's problems when every attempt is spent", async () => {
		const { h, vcs, settled, payloads } = await run("", [
			reply("notes"),
			reply("still notes"),
		]);
		await settled("paused");
		expect(payloads("task.attempt.chosen")).toEqual([]);
		expect(payloads("task.status.changed")).toEqual([
			{ from: "todo", to: "in_progress" },
			{ from: "in_progress", to: "blocked" },
		]);
		const [first] = vcs.ids("worktree.create");
		expect(vcs.ids("worktree.remove")).toEqual([first]);
		expect(h.requests).toHaveLength(2);
	});

	it("sends a revision to the attempt that went on, with no new attempt", async () => {
		const { h, vcs, runId, settled, payloads } = await run(
			", approval: human",
			[reply("notes"), PASSES, PASSES],
		);
		await settled("paused");
		const r = await h.engine.approve(runId, {
			decision: "revise",
			feedback: "shorter",
		});
		expect(r.ok).toBe(true);
		await vi.waitFor(() => expect(h.requests).toHaveLength(3));
		await settled("paused");
		expect(vcs.ids("worktree.create")).toHaveLength(2);
		expect(payloads("task.attempt.chosen")).toHaveLength(1);
		const agents = payloads("task.assigned").map(
			(p) => (p as { agentId: string }).agentId,
		);
		expect(agents).toHaveLength(3);
		expect(agents[2]).toBe(agents[1]);
		expect(
			payloads("agent.created").map(
				(p) => (p as { attempt?: unknown }).attempt,
			),
		).toEqual([
			{ k: 1, n: 2 },
			{ k: 2, n: 2 },
			{ k: 2, n: 2 },
		]);
		expect(h.requests[2]?.messages.at(-1)).toEqual({
			role: "user",
			content: "Feedback on your last submission: shorter",
		});
	});

	it("asks its questions once: the next attempt opens with the answers", async () => {
		const { h, settled } = await run(
			", before_start: { clarify_with: helper }",
			[reply("Which city?"), reply("Ankara."), reply("notes"), PASSES],
		);
		await settled("completed");
		expect(h.requests).toHaveLength(4);
		const second = h.requests[3]?.messages ?? [];
		expect(second.at(-1)).toEqual({
			role: "user",
			content: "Answers from Researcher: Ankara.",
		});
		expect(second.some((m) => m.content === "notes")).toBe(false);
	});
});

const verdict = (attempt: number, reason: string) =>
	fenced(JSON.stringify({ attempt, reason }));
const TWO = [fenced(report("First")), fenced(report("Second"))];

describe("the judge of best-of-N attempts (ADR-162)", () => {
	it("asks a judge with no tools when two attempts pass, and goes on with its choice", async () => {
		const long = (cwd: string) =>
			`${cwd}\n${"x".repeat(JUDGE_CANDIDATE_CHARS)}`;
		const { h, vcs, settled, payloads } = await run(
			"",
			[...TWO, verdict(2, "clearer")],
			long,
		);
		await settled("completed");
		const judge = h.requests[2];
		expect(judge?.target).toEqual({ tier: "reasoning" });
		expect(judge?.tools).toBeUndefined();
		const parts = String(judge?.messages[1]?.content)
			.split(/\n\nAttempt \d:\n/)
			.slice(1);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toContain('"title":"First"');
		expect(parts[1]).toContain('"title":"Second"');
		for (const part of parts) {
			expect(part).toContain("Files changed: /wt/");
			expect(part).toContain("Diff:\n/wt/");
			expect(part).toHaveLength(JUDGE_CANDIDATE_CHARS);
		}
		expect(payloads("agent.created").at(-1)).toEqual({
			roleId: "judge",
			providerId: "p",
			modelId: "m1",
			tier: "reasoning",
		});
		expect(payloads("task.attempt.chosen")).toEqual([
			{ attempt: 2, of: 2, by: "judge", reason: "clearer" },
		]);
		expect(payloads("task.status.changed")).toEqual([
			{ from: "todo", to: "in_progress" },
			{ from: "in_progress", to: "submitted" },
			{ from: "submitted", to: "approved" },
		]);
		const [first, second] = vcs.ids("worktree.create");
		expect(vcs.ids("merge")).toEqual([second]);
		expect(vcs.ids("worktree.remove")).toEqual([first, second]);
		expect(h.events.at(-1)?.payload).toEqual({ summary: report("Second") });
	});

	it("asks once more for a valid choice, then goes on with the first candidate", async () => {
		const { h, vcs, settled, payloads } = await run("", [
			...TWO,
			verdict(3, "the third"),
			reply("both are good"),
		]);
		await settled("completed");
		expect(h.requests).toHaveLength(4);
		expect(h.requests[3]?.messages.at(-1)?.content).toContain(
			"attempt must be one of 1, 2",
		);
		expect(payloads("task.attempt.chosen")).toEqual([
			{ attempt: 1, of: 2, by: "checks" },
		]);
		const [first] = vcs.ids("worktree.create");
		expect(vcs.ids("merge")).toEqual([first]);
		expect(h.events.at(-1)?.payload).toEqual({ summary: report("First") });
	});

	it("pauses a judge on exhausted quota and resumes its conversation, not a new attempt", async () => {
		const resumesAt = "2026-10-22T00:00:00.000Z";
		const spent = {
			code: "quota_exhausted" as const,
			message: "spent",
			resumesAt,
		};
		const { h, vcs, runId, settled, payloads } = await run("", [
			...TWO,
			[{ type: "error", error: spent }],
			verdict(2, "clearer"),
		]);
		await settled("paused");
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await settled("completed");
		expect(h.requests).toHaveLength(4);
		expect(h.requests[3]?.messages).toEqual(h.requests[2]?.messages);
		expect(vcs.ids("worktree.create")).toHaveLength(2);
		expect(payloads("task.attempt.chosen")).toEqual([
			{ attempt: 2, of: 2, by: "judge", reason: "clearer" },
		]);
	});

	it("opens the judge on resume when the run paused while it read the candidates", async () => {
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let first = true;
		const held = async (cwd: string) => {
			if (first) {
				first = false;
				await gate;
			}
			return `diff in ${cwd}`;
		};
		const { h, vcs, runId, settled, payloads } = await run(
			"",
			[...TWO, verdict(2, "clearer")],
			held,
		);
		await vi.waitFor(() => expect(vcs.ids("diff")).toHaveLength(1));
		expect((await h.engine.pause(runId)).ok).toBe(true);
		release();
		await settled("paused");
		expect(h.requests).toHaveLength(2);
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await settled("completed");
		expect(h.requests).toHaveLength(3);
		expect(payloads("task.attempt.chosen")).toEqual([
			{ attempt: 2, of: 2, by: "judge", reason: "clearer" },
		]);
		expect(vcs.ids("worktree.create")).toHaveLength(2);
	});

	it("records the last attempt once when a crash came before the judge opened", async () => {
		await writeFile(join(templates.builtIn, "best.yaml"), BEST());
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const stuck = fakeVcs(async (cwd) => {
			await gate;
			return `diff in ${cwd}`;
		});
		const crashed = harness(stuck, TWO);
		const r = await crashed.engine.start({
			goal: "a page",
			templateId: "best",
		});
		if (!r.ok) throw new Error(r.error.message);
		await vi.waitFor(() => expect(stuck.ids("diff")).toHaveLength(1));
		const later = harness(fakeVcs(), [verdict(2, "clearer")], crashed.db);
		later.recover();
		expect((await later.engine.resume(r.value.runId)).ok).toBe(true);
		await vi.waitFor(() =>
			expect(later.engine.status(r.value.runId)).toMatchObject({
				value: [{ status: "completed" }],
			}),
		);
		const parts = String(later.requests[0]?.messages[1]?.content).split(
			/\n\nAttempt \d:\n/,
		);
		expect(parts).toHaveLength(3);
		expect(
			later.events.find((e) => e.type === "task.attempt.chosen")?.payload,
		).toEqual({ attempt: 2, of: 2, by: "judge", reason: "clearer" });
		const stopped = crashed.stop();
		release();
		await stopped;
		await later.stop();
	});
});
