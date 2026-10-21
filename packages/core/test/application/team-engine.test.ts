import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunView } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactStore } from "../../src/infrastructure/artifact-store.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, typesOf } from "../helpers/engine.js";

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
