import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const REPORT = JSON.stringify({
	title: "T",
	summary: "S",
	findings: [{ claim: "C", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.com", title: "E" }],
});
const PASSES = reply(`\`\`\`json\n${REPORT}\n\`\`\``);

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-attempts-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
});
afterEach(() => rm(root, { recursive: true, force: true }));

// A vcs.git@2 that gives each worktree a folder of its own and records what it was asked.
const fakeVcs = () => {
	const calls: { op: string; taskId?: string }[] = [];
	const run: Tool = async (input) => {
		const i = input as { op: string; taskId?: string };
		calls.push(i);
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

const run = async (extra: string, scripts: Script[]) => {
	await writeFile(join(templates.builtIn, "best.yaml"), BEST(extra));
	const vcs = fakeVcs();
	const h = engineHarness({
		scripts,
		templates,
		tools: [
			["fs.write@1", async () => ok({ bytes: 1 })],
			["vcs.git@2", vcs.run],
		],
	});
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
