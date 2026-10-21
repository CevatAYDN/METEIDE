import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunView } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it("waits with reason approval for an approver role until reviews exist", async () => {
		const withLead = PIPELINE.replace(
			"context: [find] }",
			"context: [find], approval: lead }",
		);
		await writeFile(join(templates.builtIn, "duo.yaml"), withLead);
		const h = engineHarness({
			scripts: [reply("facts"), reply("draft")],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
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
