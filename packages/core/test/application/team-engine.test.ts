import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CapabilityRef,
	ok,
	type Result,
	type RunView,
} from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactStore } from "../../src/infrastructure/artifact-store.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import {
	engineHarness,
	reply,
	type Script,
	type Tool,
	typesOf,
} from "../helpers/engine.js";

// A pipeline of two tasks: the second reads the first one's report.
const PIPELINE = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: finder, name: Finder, goal: Find facts, tier: reasoning, capabilities: [fs.read@1] }
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
  - { id: lead, name: Lead, goal: Approve, tier: reasoning, capabilities: [] }
tasks:
  - { id: find, role: finder, title: Find facts }
  - { id: write, role: writer, title: Write it up, context: [find] }
budget: { cloud_requests: 5 }
`;

// One guarded task whose report must be a research-report@1, repaired at most once.
const GUARDED = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: single
roles:
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: report, role: writer, title: Report, guardrail: { schema: research-report@1, max_retries: 1 } }
`;

const REPORT = JSON.stringify({
	title: "T",
	summary: "S",
	findings: [{ claim: "C", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.com", title: "E" }],
});

// The pipeline with the lead approving the write-up; `extra` adds top-level keys.
const useLead = (extra = "") =>
	writeFile(
		join(templates.builtIn, "duo.yaml"),
		PIPELINE.replace("context: [find] }", "context: [find], approval: lead }") +
			extra,
	);

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-team-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "duo.yaml"), PIPELINE);
});
afterEach(() => rm(root, { recursive: true, force: true }));

type H = ReturnType<typeof engineHarness>;
const view = (h: H, runId: string): RunView | undefined => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0] : undefined;
};
const settled = (h: H, runId: string, status: string) =>
	vi.waitFor(() => expect(view(h, runId)?.status).toBe(status));
const start = async (h: H, templateId = "duo") => {
	const r = await h.engine.start({ goal: "free models", templateId });
	if (!r.ok) throw new Error(r.error.message);
	return r.value.runId;
};

describe("team runs", () => {
	it("runs the tasks in order, hands the report on and completes with the last one", async () => {
		const h = engineHarness({
			scripts: [reply("three facts"), reply("the write-up")],
			tools: [["fs.read@1", async () => ({ ok: true, value: {} })]],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		expect(view(h, runId)).toMatchObject({
			templateId: "duo",
			budget: { cloudRequests: 5, maxHours: 6 },
		});
		expect(h.events.at(-1)?.payload).toEqual({ summary: "the write-up" });
		const [find, write] = h.requests;
		expect(find?.target).toEqual({ tier: "reasoning" });
		expect(find?.tools?.map((t) => t.name)).toEqual(["fs_read"]);
		expect(write?.target).toEqual({ tier: "fast" });
		expect(write?.tools).toBeUndefined();
		expect(String(write?.messages[1]?.content)).toContain(
			"Report of Find facts:\nthree facts",
		);
		const types = typesOf(h.events).filter((t) => t.startsWith("task."));
		expect(types).toEqual([
			"task.created",
			"task.created",
			"task.assigned",
			"task.status.changed",
			"task.status.changed",
			"task.status.changed",
			"task.assigned",
			"task.status.changed",
			"task.status.changed",
			"task.status.changed",
		]);
		const created = h.events.filter((e) => e.type === "task.created");
		expect(created[1]?.payload).toMatchObject({
			roleId: "writer",
			dependsOn: [created[0]?.taskId],
		});
		expect(
			h.db.prepare("SELECT role_id FROM agents ORDER BY rowid").all(),
		).toEqual([{ role_id: "finder" }, { role_id: "writer" }]);
	});

	it("sends a role its pinned model from .mete/pins.yaml, and each agent its role tier (ADR-077)", async () => {
		await mkdir(join(root, ".mete"));
		await writeFile(
			join(root, ".mete", "pins.yaml"),
			"duo:\n  writer: groq/openai/gpt-oss-120b\n",
		);
		const h = engineHarness({
			scripts: [reply("three facts"), reply("the write-up")],
			tools: [["fs.read@1", async () => ({ ok: true, value: {} })]],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		const [find, write] = h.requests;
		expect(find?.prefer).toBeUndefined();
		expect(write?.prefer).toEqual({
			providerId: "groq",
			modelId: "openai/gpt-oss-120b",
		});
		const created = h.events.filter((e) => e.type === "agent.created");
		expect(created.map((e) => e.payload)).toEqual([
			{ roleId: "finder", providerId: "p", modelId: "m1", tier: "reasoning" },
			{ roleId: "writer", providerId: "p", modelId: "m1", tier: "fast" },
		]);
	});

	it("runs without pins when the pins file does not validate, and says which file", async () => {
		await mkdir(join(root, ".mete"));
		await writeFile(join(root, ".mete", "pins.yaml"), "duo:\n  writer: groq\n");
		const h = engineHarness({
			scripts: [reply("three facts"), reply("the write-up")],
			tools: [["fs.read@1", async () => ({ ok: true, value: {} })]],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		expect(h.requests.map((r) => r.prefer)).toEqual([undefined, undefined]);
		expect(
			h.logged.some((l) => l.level === "warn" && l.msg.includes("pins.yaml")),
		).toBe(true);
	});

	it("lets the lead approve the write-up in a review of its own and completes", async () => {
		await useLead();
		const h = engineHarness({
			scripts: [
				reply("facts"),
				reply("draft"),
				reply('{"decision":"approve"}'),
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		const review = h.requests[2];
		expect(review?.target).toEqual({ tier: "reasoning" });
		expect(String(review?.messages[1]?.content)).toContain(
			"Submission:\ndraft",
		);
		const approvals = h.events.filter((e) => e.type.startsWith("approval."));
		expect(approvals.map((e) => [e.type, e.payload])).toEqual([
			["approval.requested", { approver: "lead" }],
			["approval.resolved", { approver: "lead", decision: "approve" }],
		]);
		expect(
			h.db.prepare("SELECT role_id FROM agents ORDER BY rowid").all(),
		).toEqual([
			{ role_id: "finder" },
			{ role_id: "writer" },
			{ role_id: "lead" },
		]);
	});

	it("sends the work back with feedback and blocks it past the revision limit", async () => {
		await useLead("policies: { revision_limit: 1 }\n");
		const revise = reply('{"decision":"revise","feedback":"cite sources"}');
		const h = engineHarness({
			scripts: [
				reply("facts"),
				reply("draft"),
				revise,
				reply("draft 2"),
				revise,
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
		expect(h.requests[3]?.messages.at(-1)).toEqual({
			role: "user",
			content: "Feedback on your last submission: cite sources",
		});
		const last = h.events
			.filter((e) => e.type === "task.status.changed")
			.at(-1);
		expect(last?.payload).toEqual({ from: "submitted", to: "blocked" });
	});

	it("keeps each submission as the task's artifact and announces created, then updated", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			PIPELINE.replace(
				"context: [find] }",
				"context: [find], approval: lead, expected_output: artifact:research-report@1 }",
			),
		);
		const revise = reply('{"decision":"revise","feedback":"shorter"}');
		const approveIt = reply('{"decision":"approve"}');
		const h = engineHarness({
			scripts: [
				reply("facts"),
				reply("draft"),
				revise,
				reply("draft 2"),
				approveIt,
			],
			templates,
			artifacts: createArtifactStore(root),
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		const events = h.events.filter((e) => e.type.startsWith("artifact."));
		const path = `.mete/artifacts/${runId}/write.md`;
		const [created] = events;
		const artifactId =
			created?.type === "artifact.created" ? created.payload.artifactId : "";
		const payload = { artifactId, type: "research-report@1", path };
		expect(events.map((e) => [e.type, e.payload])).toEqual([
			["artifact.created", payload],
			["artifact.updated", payload],
		]);
		expect(await readFile(join(root, path), "utf8")).toBe("draft 2");
	});

	it("waits for the human at a checkpoint and goes on once they approve", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			`${PIPELINE}policies: { human_checkpoints: [write] }\n`,
		);
		const h = engineHarness({
			scripts: [reply("facts"), reply("draft")],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		const asked = h.events.find((e) => e.type === "approval.requested");
		expect(asked?.payload).toEqual({ approver: "human" });
		const r = await h.engine.approve(runId, { decision: "approve" });
		expect(r.ok).toBe(true);
		await settled(h, runId, "completed");
		const resolved = h.events.find((e) => e.type === "approval.resolved");
		expect(resolved?.payload).toEqual({
			approver: "human",
			decision: "approve",
		});
		const again = await h.engine.approve(runId, { decision: "approve" });
		expect(again.ok ? "ok" : again.error.code).toBe("invalid_state");
	});

	it("takes the human's approval in a new process that reads the team run back", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			`${PIPELINE.replace("context: [find] }", "context: [find], expected_output: artifact:research-report@1 }")}policies: { human_checkpoints: [write] }\n`,
		);
		const artifacts = createArtifactStore(root);
		const first = engineHarness({
			scripts: [reply("facts"), reply("draft")],
			templates,
			artifacts,
		});
		const runId = await start(first);
		await settled(first, runId, "paused");
		await first.stop();
		// Every field of a rich team snapshot goes through the strict schemas here.
		const later = engineHarness({
			scripts: [],
			db: first.db,
			templates,
			artifacts,
		});
		const r = await later.engine.approve(runId, { decision: "approve" });
		expect(r.ok ? "ok" : r.error.message).toBe("ok");
		await settled(later, runId, "completed");
		expect(later.events.at(-1)?.payload).toEqual({ summary: "draft" });
	});

	it("sends a blocked task back to work with the human's instruction", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), GUARDED);
		const h = engineHarness({
			scripts: [reply("notes"), reply("still notes"), reply(REPORT)],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		const missing = await h.engine.approve(runId, {
			taskId: "nope",
			decision: "approve",
		});
		expect(missing.ok ? "ok" : missing.error.code).toBe("not_found");
		const r = await h.engine.approve(runId, {
			taskId: "report",
			decision: "revise",
			feedback: "Answer with the JSON only",
		});
		expect(r.ok).toBe(true);
		await settled(h, runId, "completed");
		expect(h.requests[2]?.messages.at(-1)).toEqual({
			role: "user",
			content: "Feedback on your last submission: Answer with the JSON only",
		});
	});

	it("taints a task's later tool calls once web content joined it", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			PIPELINE.replace(
				"capabilities: [fs.read@1]",
				"capabilities: [web.search@1, fs.read@1]",
			),
		);
		const seen: { ref: string; tainted: boolean | undefined }[] = [];
		const tool = (ref: CapabilityRef): readonly [CapabilityRef, Tool] => [
			ref,
			async (_input, ctx) => {
				seen.push({ ref, tainted: ctx.tainted });
				return ok({});
			},
		];
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "web_search", args: { query: "free models" } }]),
				reply("", [{ name: "fs_read", args: { path: "a.md" } }]),
				reply("facts"),
				reply("draft"),
			],
			tools: [tool("web.search@1"), tool("fs.read@1")],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		expect(seen).toEqual([
			{ ref: "web.search@1", tainted: undefined },
			{ ref: "fs.read@1", tainted: true },
		]);
		const fed = h.requests[1]?.messages.at(-1);
		expect(String(fed?.content)).toMatch(
			/^External content from the web follows/,
		);
	});

	it("asks the reviewer again for a reply that is no verdict", async () => {
		await useLead();
		const h = engineHarness({
			scripts: [
				reply("facts"),
				reply("draft"),
				reply("looks fine"),
				reply('{"decision":"approve"}'),
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		expect(String(h.requests[3]?.messages.at(-1)?.content)).toContain(
			"Your verdict is not valid",
		);
	});

	it("pauses a review on exhausted quota like any model call", async () => {
		await useLead();
		const resumesAt = "2026-10-22T00:00:00.000Z";
		const h = engineHarness({
			scripts: [
				reply("facts"),
				reply("draft"),
				[
					{
						type: "error",
						error: { code: "quota_exhausted", message: "spent", resumesAt },
					},
				],
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("quota");
		expect(h.events.find((e) => e.type === "run.paused")?.payload).toEqual({
			reason: "quota",
			resumesAt,
		});
	});

	it("asks for a repair when the report fails its guardrail and submits the repaired one", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), GUARDED);
		const h = engineHarness({
			scripts: [
				reply("here are my notes"),
				reply(`\`\`\`json\n${REPORT}\n\`\`\``),
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		const repair = h.requests[1]?.messages.at(-1);
		expect(repair?.role).toBe("user");
		expect(String(repair?.content)).toContain(
			"Your report does not match research-report@1",
		);
		expect(h.events.at(-1)?.payload).toEqual({ summary: REPORT });
	});

	it("blocks the task when the repairs run out and pauses the run", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), GUARDED);
		const h = engineHarness({
			scripts: [reply("notes"), reply("still notes")],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
		const last = h.events
			.filter((e) => e.type === "task.status.changed")
			.at(-1);
		expect(last?.payload).toEqual({ from: "in_progress", to: "blocked" });
		expect(h.requests).toHaveLength(2);
	});

	it("routes a run without a template, and lets the user choose when the router is unsure", async () => {
		const sure = reply('{"mode":"team","templateId":"duo","confidence":0.9}');
		const h = engineHarness({
			scripts: [sure, reply("facts"), reply("the write-up")],
			templates,
		});
		const r = await h.engine.start({ goal: "free models" });
		if (!r.ok) throw new Error(r.error.message);
		await settled(h, r.value.runId, "completed");
		expect(view(h, r.value.runId)?.templateId).toBe("duo");
		expect(h.requests[0]?.target).toEqual({ tier: "fast" });

		const unsure = reply('{"mode":"team","templateId":"duo","confidence":0.4}');
		const other = engineHarness({ scripts: [unsure], templates });
		expect(await other.engine.start({ goal: "free models" })).toEqual({
			ok: false,
			error: expect.objectContaining({
				code: "choose_template",
				suggestions: ["duo"],
			}),
		});
		expect(other.engine.status()).toEqual({ ok: true, value: [] });
	});

	it("answers not_found, bad_input and not_supported for templates it cannot use", async () => {
		const h = engineHarness({ scripts: [], templates });
		const code = async (templateId: string) => {
			const r = await h.engine.start({ goal: "g", templateId });
			return r.ok ? "ok" : r.error.code;
		};
		expect(await code("missing")).toBe("not_found");
		await writeFile(join(templates.builtIn, "bad.yaml"), "kind: x");
		expect(await code("bad")).toBe("bad_input");
		const none = engineHarness({ scripts: [] });
		const r = await none.engine.start({ goal: "g", templateId: "duo" });
		expect(r.ok ? "ok" : r.error.code).toBe("not_supported");
	});
});

// One task whose report must pass the build command and a guardrail that allows one repair, so a
// gate that spent that repair would block the task later. Its role lists no tools: a gate is not the agent's call.
const GATED = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [] }
tasks:
  - id: build
    role: dev
    title: Build
    verify: [{ run: "pnpm build" }]
    guardrail: { schema: research-report@1, max_retries: 1 }
`;

const built = (exitCode: number | null, stderr = "") =>
	ok({
		exitCode,
		stdout: "",
		stderr,
		os: "linux",
		shell: "sh",
		timedOut: false,
	});

describe("verify gates", () => {
	it("send a failing build back with its output, spend no guardrail repair and pass once it succeeds", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), GATED);
		const commands: unknown[] = [];
		const shell: Tool = async (input) => {
			commands.push(input);
			return commands.length === 1
				? built(1, "src/a.ts: error TS2304: Cannot find name 'x'")
				: built(0);
		};
		const h = engineHarness({
			// The second reply fails the guardrail: its one repair is still there after the gate.
			scripts: [reply(REPORT), reply("notes"), reply(REPORT)],
			tools: [["shell.exec@1", shell]],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		expect(commands).toHaveLength(3);
		expect(commands[0]).toEqual({ command: "pnpm build" });
		const feedback = h.requests[1]?.messages.at(-1);
		expect(feedback?.role).toBe("user");
		expect(String(feedback?.content)).toContain(
			"The verify gate `pnpm build` exited with code 1.",
		);
		expect(String(feedback?.content)).toContain("error TS2304");
		expect(h.events.at(-1)?.payload).toEqual({ summary: REPORT });
		// Each gate that ran publishes verify.completed (docs/07), with what failed as details.
		const gates = h.events.filter((e) => e.type === "verify.completed");
		expect(gates.map((e) => e.payload)).toEqual([
			{
				gate: "pnpm build",
				ok: false,
				details: expect.stringContaining("error TS2304"),
			},
			{ gate: "pnpm build", ok: true, details: "" },
			{ gate: "pnpm build", ok: true, details: "" },
		]);
		expect(gates.every((e) => e.taskId !== undefined)).toBe(true);
	});

	it("pause the run for approval when the policy asks about the command, and run it again on resume", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), GATED);
		const asks = { code: "approval_required", message: "asks", rule: "r" };
		let n = 0;
		const shell: Tool = async () =>
			n++ === 0 ? { ok: false, error: asks } : built(0);
		const h = engineHarness({
			scripts: [reply(REPORT)],
			tools: [["shell.exec@1", shell]],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
		h.engine.resume(runId);
		await settled(h, runId, "completed");
		expect(n).toBe(2);
		expect(h.requests).toHaveLength(1);
		// The gate the policy asked about did not run, so only the run after resume is published.
		expect(
			h.events
				.filter((e) => e.type === "verify.completed")
				.map((e) => e.payload),
		).toEqual([{ gate: "pnpm build", ok: true, details: "" }]);
	});

	it("block the task when no shell is active", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), GATED);
		const h = engineHarness({ scripts: [reply(REPORT)], templates });
		const runId = await start(h);
		await settled(h, runId, "paused");
		const last = h.events
			.filter((e) => e.type === "task.status.changed")
			.at(-1);
		expect(last?.payload).toEqual({ from: "in_progress", to: "blocked" });
		expect(h.requests).toHaveLength(1);
	});
});

// A developer who writes files and a writer who does not: only the developer's task gets a worktree.
const BUILDER = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [fs.write@1] }
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: build, role: dev, title: Build }
  - { id: report, role: writer, title: Report, context: [build] }
`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A fake vcs.git@2 that records what it was asked and in which working folder.
const fakeVcs = (
	create: () => Result<unknown, { code: string; message: string }>,
	merge: () => Result<unknown, { code: string; message: string }> = () =>
		ok({ op: "merge", sha: "m" }),
) => {
	const calls: {
		input: { op: string; runId?: string; taskId?: string };
		cwd?: string;
	}[] = [];
	const hooks = { onRemove: () => {} };
	const run: Tool = async (input, ctx) => {
		const i = input as { op: string };
		calls.push({ input: i, ...(ctx.cwd ? { cwd: ctx.cwd } : {}) });
		if (i.op === "worktree.create") return create();
		if (i.op === "merge") return merge();
		if (i.op === "worktree.remove") {
			hooks.onRemove();
			return ok({ op: "worktree.remove", removed: true });
		}
		return ok({
			op: "checkpoint.create",
			ref: "refs/mete/checkpoints/r/1",
			sha: "s",
		});
	};
	return { calls, run, hooks };
};

const WRITE = reply("", [
	{ name: "fs_write", args: { path: "a.txt", content: "x\n" } },
]);

describe("worktrees of writing tasks", () => {
	it("starts one for a task whose role writes and runs its tools, checkpoints and gates there", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), BUILDER);
		const vcs = fakeVcs(() =>
			ok({ op: "worktree.create", path: "/wt", branch: "mete/r/t", sha: "s" }),
		);
		const writes: (string | undefined)[] = [];
		const write: Tool = async (_input, ctx) => {
			writes.push(ctx.cwd);
			return ok({ bytes: 2 });
		};
		const h = engineHarness({
			scripts: [WRITE, reply("built"), reply("the report")],
			tools: [
				["fs.write@1", write],
				["vcs.git@2", vcs.run],
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");
		const creates = vcs.calls.filter((c) => c.input.op === "worktree.create");
		expect(creates).toHaveLength(1);
		expect(creates[0]?.input).toMatchObject({ op: "worktree.create", runId });
		expect(creates[0]?.input.taskId).toMatch(UUID);
		expect(creates[0]).not.toHaveProperty("cwd");
		expect(writes).toEqual(["/wt"]);
		const checkpoints = vcs.calls.filter(
			(c) => c.input.op === "checkpoint.create",
		);
		// The task's own checkpoint is taken in its worktree, the one before the merge in the workspace.
		expect(checkpoints.map((c) => c.cwd)).toEqual(["/wt", undefined]);
		expect(vcs.calls.map((c) => c.input.op)).toEqual([
			"worktree.create",
			"checkpoint.create",
			"checkpoint.create",
			"merge",
			"worktree.remove",
		]);
		const merged = vcs.calls.find((c) => c.input.op === "merge");
		expect(merged?.input).toMatchObject({ runId, message: "Build" });
		expect(merged?.input.taskId).toBe(creates[0]?.input.taskId);
		expect(merged).not.toHaveProperty("cwd");
	});

	it("names the worktree on the request a human gets for a task that wrote there (ADR-132)", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			BUILDER.replace("title: Build }", "title: Build, approval: human }"),
		);
		const vcs = fakeVcs(() =>
			ok({ op: "worktree.create", path: "/wt", branch: "mete/r/t", sha: "s" }),
		);
		const h = engineHarness({
			scripts: [WRITE, reply("built")],
			tools: [
				["fs.write@1", async () => ok({ bytes: 2 })],
				["vcs.git@2", vcs.run],
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		const asked = h.events.find((e) => e.type === "approval.requested");
		expect(asked?.payload).toEqual({ approver: "human", worktree: "/wt" });
	});

	it("lists on that request the files git sees changed in the worktree, not deleted ones, and none past the cap (ADR-141)", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			BUILDER.replace("title: Build }", "title: Build, approval: human }"),
		);
		const askedWith = async (files: readonly object[]) => {
			const vcs = fakeVcs(() =>
				ok({ op: "worktree.create", path: "/wt", branch: "b", sha: "s" }),
			);
			const at: (string | undefined)[] = [];
			const git: Tool = async (input, ctx) => {
				if ((input as { op: string }).op !== "status")
					return vcs.run(input, ctx);
				at.push(ctx.cwd);
				return ok({ op: "status", branch: "b", files });
			};
			const h = engineHarness({
				scripts: [WRITE, reply("built")],
				tools: [
					["fs.write@1", async () => ok({ bytes: 2 })],
					["vcs.git@2", git],
				],
				templates,
			});
			const runId = await start(h);
			await settled(h, runId, "paused");
			expect(at).toEqual(["/wt"]);
			return h.events.find((e) => e.type === "approval.requested")?.payload;
		};
		const row = (path: string, index: string, worktree: string) => ({
			path,
			index,
			worktree,
		});
		expect(
			await askedWith([
				row("index.html", "?", "?"),
				row("css/site.css", " ", "M"),
				row("old.txt", " ", "D"),
				row("gone.txt", "D", " "),
			]),
		).toEqual({
			approver: "human",
			worktree: "/wt",
			files: ["index.html", "css/site.css"],
		});
		const many = Array.from({ length: 201 }, (_, i) => row(`f${i}`, "?", "?"));
		expect(await askedWith(many)).toEqual({
			approver: "human",
			worktree: "/wt",
		});
	});

	it("starts none without vcs.git@2 or when git cannot make one, and logs why", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), BUILDER);
		const bare = engineHarness({
			scripts: [WRITE, reply("built"), reply("the report")],
			tools: [["fs.write@1", async () => ok({ bytes: 2 })]],
			templates,
		});
		await settled(bare, await start(bare), "completed");

		const cwds: (string | undefined)[] = [];
		const refused = fakeVcs(() => ({
			ok: false,
			error: { code: "io", message: "the repository has no commit yet" },
		}));
		const h = engineHarness({
			scripts: [WRITE, reply("built"), reply("the report")],
			tools: [
				[
					"fs.write@1",
					async (_i, ctx) => {
						cwds.push(ctx.cwd);
						return ok({ bytes: 2 });
					},
				],
				["vcs.git@2", refused.run],
			],
			templates,
		});
		await settled(h, await start(h), "completed");
		expect(cwds).toEqual([undefined]);
		expect(h.logged.some((l) => l.msg.includes("worktree not created"))).toBe(
			true,
		);
	});
});

describe("merging an approved task's worktree", () => {
	const made = () =>
		ok({ op: "worktree.create", path: "/wt", branch: "b", sha: "s" });

	it("pauses the run for the human when the merge conflicts, keeps the worktree and merges again on approve", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), BUILDER);
		let tries = 0;
		const vcs = fakeVcs(made, () => {
			tries += 1;
			return tries === 1
				? {
						ok: false,
						error: {
							code: "merge_conflict",
							message: "merging a.txt conflicts with the workspace",
							paths: ["a.txt"],
						},
					}
				: ok({ op: "merge", sha: "m" });
		});
		const h = engineHarness({
			scripts: [WRITE, reply("built"), reply("the report")],
			tools: [
				["fs.write@1", async () => ok({ bytes: 2 })],
				["vcs.git@2", vcs.run],
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
		const failed = h.events.find((e) => e.type === "task.merge.failed");
		expect(failed?.payload).toEqual({
			code: "merge_conflict",
			message: "merging a.txt conflicts with the workspace",
			branch: `mete/${runId}/${failed?.taskId}`,
			paths: ["a.txt"],
		});
		expect(vcs.calls.map((c) => c.input.op)).not.toContain("worktree.remove");

		const revised = await h.engine.approve(runId, {
			decision: "revise",
			feedback: "x",
		});
		expect(revised.ok ? "ok" : revised.error.message).toContain(
			"waits for its merge",
		);
		expect((await h.engine.approve(runId, { decision: "approve" })).ok).toBe(
			true,
		);
		await settled(h, runId, "completed");
		expect(tries).toBe(2);
		expect(
			vcs.calls.filter((c) => c.input.op === "worktree.remove"),
		).toHaveLength(1);
		expect(h.requests).toHaveLength(3);
	});

	it("merges before the next task starts and records the merge before it removes the worktree", async () => {
		await writeFile(join(templates.builtIn, "duo.yaml"), BUILDER);
		const order: string[] = [];
		const vcs = fakeVcs(made, () => {
			order.push("merge");
			return ok({ op: "merge", sha: "m" });
		});
		const second: Script = async function* () {
			order.push("next task");
			yield* reply("the report");
		};
		let held: () => string = () => "";
		vcs.hooks.onRemove = () => {
			order.push("remove");
			order.push(held().includes('"worktree"') ? "still recorded" : "recorded");
		};
		const h = engineHarness({
			scripts: [WRITE, reply("built"), second],
			tools: [
				["fs.write@1", async () => ok({ bytes: 2 })],
				["vcs.git@2", vcs.run],
			],
			templates,
		});
		held = () =>
			String(
				(
					h.db.prepare("SELECT snapshot FROM runs").get() as {
						snapshot: string;
					}
				).snapshot,
			);
		await settled(h, await start(h), "completed");
		// The record that the worktree is merged is saved before the cleanup that deletes it.
		expect(order).toEqual(["merge", "remove", "recorded", "next task"]);
	});
});
