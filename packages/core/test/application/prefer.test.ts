import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRef, RunView } from "@mete/contracts";
import { ok } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "../../src/infrastructure/run-store.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, T0, type Tool } from "../helpers/engine.js";

const MODEL_A: ModelRef = { providerId: "prov-a", modelId: "mod-a" };
const MODEL_B: ModelRef = { providerId: "prov-b", modelId: "mod-b" };
const MODEL_PIN: ModelRef = { providerId: "prov-pin", modelId: "mod-pin" };

const PIPELINE = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: finder, name: Finder, goal: Find facts, tier: reasoning, capabilities: [fs.read@1] }
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: find, role: finder, title: Find facts }
  - { id: write, role: writer, title: Write it up, context: [find] }
budget: { cloud_requests: 10 }
`;

type H = ReturnType<typeof engineHarness>;

const view = (h: H, runId: string): RunView | undefined => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0] : undefined;
};

const settled = (h: H, runId: string, status: string) =>
	vi.waitFor(() => expect(view(h, runId)?.status).toBe(status));

describe("model selection at start and run time (ADR-122)", () => {
	let tmpDir: string;
	let templates: TemplateDirs;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mete-prefer-test-"));
		const builtIn = join(tmpDir, "templates");
		const workspace = join(tmpDir, "workspace");
		await mkdir(builtIn, { recursive: true });
		await mkdir(join(workspace, ".mete", "teams"), { recursive: true });
		await writeFile(join(builtIn, "duo.yaml"), PIPELINE);
		templates = { builtIn, workspace };
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("single-agent start honors prefer and sends it in model chat request", async () => {
		const h = engineHarness({
			scripts: [reply("All done.")],
		});
		const startRes = await h.engine.start({
			goal: "test goal",
			prefer: MODEL_A,
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;
		await settled(h, runId, "completed");

		expect(h.requests.length).toBe(1);
		expect(h.requests[0]?.prefer).toEqual(MODEL_A);
	});

	it("team start honors per-role prefer", async () => {
		const h = engineHarness({
			scripts: [reply("Found the facts."), reply("Wrote the report.")],
			templates,
		});
		const startRes = await h.engine.start({
			goal: "team goal",
			templateId: "duo",
			prefer: { finder: MODEL_A, writer: MODEL_B },
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;
		await settled(h, runId, "completed");

		expect(h.requests.length).toBe(2);
		expect(h.requests[0]?.prefer).toEqual(MODEL_A);
		expect(h.requests[1]?.prefer).toEqual(MODEL_B);
	});

	it("run preference takes precedence over workspace pin in .mete/pins.yaml", async () => {
		// Workspace pins duo template's finder role to MODEL_PIN
		await writeFile(
			join(templates.workspace, ".mete", "pins.yaml"),
			"duo:\n  finder: prov-pin/mod-pin\n",
		);

		const h = engineHarness({
			scripts: [reply("Finder finished."), reply("Writer finished.")],
			templates,
		});

		// Run specifies finder prefer as MODEL_A
		const startRes = await h.engine.start({
			goal: "team goal",
			templateId: "duo",
			prefer: { finder: MODEL_A },
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;
		await settled(h, runId, "completed");

		// First task (finder) receives run preference MODEL_A, not MODEL_PIN
		expect(h.requests[0]?.prefer).toEqual(MODEL_A);
	});

	it("falls back to .mete/pins.yaml when role has no run preference", async () => {
		await writeFile(
			join(templates.workspace, ".mete", "pins.yaml"),
			"duo:\n  finder: prov-pin/mod-pin\n",
		);

		const h = engineHarness({
			scripts: [reply("Finder done."), reply("Writer done.")],
			templates,
		});

		// No run preference given
		const startRes = await h.engine.start({
			goal: "team goal",
			templateId: "duo",
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;
		await settled(h, runId, "completed");

		// First task (finder) receives workspace pin
		expect(h.requests[0]?.prefer).toEqual(MODEL_PIN);
	});

	it("persists prefer and preferRevision in snapshot across quota pause and auto-resume", async () => {
		const resumesAt = new Date(T0 + 60_000).toISOString();
		const h = engineHarness({
			scripts: [
				[
					{
						type: "error",
						error: { code: "quota_exhausted", message: "spent", resumesAt },
					},
				],
				reply("Finished after resume."),
			],
		});

		const startRes = await h.engine.start({
			goal: "quota test",
			prefer: MODEL_A,
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;

		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("quota");

		// Verify persisted snapshot in database
		const row = h.db
			.prepare("SELECT snapshot FROM runs WHERE id = ?")
			.get(runId) as {
			snapshot: string;
		};
		const loaded = loadSnapshot(row.snapshot);
		expect(loaded.context.prefer).toEqual(MODEL_A);
		expect(loaded.context.preferRevision).toBe(0);

		// Trigger auto-resume
		expect(h.timers.length).toBe(1);
		h.clock.now = T0 + 60_000;
		h.timers[0]?.fn();

		await settled(h, runId, "completed");
		// Second call after resume preserved MODEL_A
		expect(h.requests.length).toBe(2);
		expect(h.requests[1]?.prefer).toEqual(MODEL_A);
	});

	it("mid-run engine.model invalidates cache and applies on the next model call", async () => {
		let ranTool: () => void = () => {};
		const toolPromise = new Promise<void>((resolve) => {
			ranTool = resolve;
		});

		const fakeTool: Tool = vi.fn(async () => {
			ranTool();
			return ok({ replacements: 1 });
		});
		const vcs: Tool = vi.fn(async () =>
			ok({ op: "checkpoint.create", ref: "r", sha: "s" }),
		);

		const h = engineHarness({
			scripts: [
				// Turn 1 calls tool
				reply(
					"",
					[
						{
							name: "fs_edit",
							args: { path: "a.ts", oldStr: "foo", newStr: "bar" },
						},
					],
					"mod-initial",
				),
				// Turn 2 replies text
				reply("Finished step 2.", [], "mod-b"),
			],
			tools: [
				["fs.edit@1", fakeTool],
				["vcs.git@2", vcs],
			],
		});

		const startRes = await h.engine.start({
			goal: "mid-run test",
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;

		// Wait for first tool call to execute
		await toolPromise;

		// Mid-run change: set model to targetModel
		const targetModel: ModelRef = { providerId: "p", modelId: "mod-b" };
		const modelRes = await h.engine.model?.(runId, targetModel);
		expect(modelRes?.ok).toBe(true);

		await settled(h, runId, "completed");

		// First request had no prefer
		expect(h.requests[0]?.prefer).toBeUndefined();
		// Second request immediately had targetModel
		expect(h.requests[1]?.prefer).toEqual(targetModel);

		// Verify agent.model.changed was emitted with reason user (ADR-122)
		const changed = h.events.find((e) => e.type === "agent.model.changed");
		expect(changed?.payload).toEqual({
			from: { providerId: "p", modelId: "mod-initial" },
			to: targetModel,
			reason: "user",
		});
	});

	it("mid-run engine.model clears preference when passed null", async () => {
		let ranTool: () => void = () => {};
		const toolPromise = new Promise<void>((resolve) => {
			ranTool = resolve;
		});

		const fakeTool: Tool = vi.fn(async () => {
			ranTool();
			return ok({ replacements: 1 });
		});
		const vcs: Tool = vi.fn(async () =>
			ok({ op: "checkpoint.create", ref: "r", sha: "s" }),
		);

		const h = engineHarness({
			scripts: [
				reply("", [
					{
						name: "fs_edit",
						args: { path: "a.ts", oldStr: "foo", newStr: "bar" },
					},
				]),
				reply("Finished step 2."),
			],
			tools: [
				["fs.edit@1", fakeTool],
				["vcs.git@2", vcs],
			],
		});

		const startRes = await h.engine.start({
			goal: "clear test",
			prefer: MODEL_A,
		});
		expect(startRes.ok).toBe(true);
		if (!startRes.ok) return;
		const runId = startRes.value.runId;

		await toolPromise;

		// Clear preference mid-run
		const modelRes = await h.engine.model?.(runId, null);
		expect(modelRes?.ok).toBe(true);

		await settled(h, runId, "completed");

		expect(h.requests[0]?.prefer).toEqual(MODEL_A);
		expect(h.requests[1]?.prefer).toBeUndefined();
	});

	it("engine.model rejects non-existent and completed runs", async () => {
		const h = engineHarness({
			scripts: [reply("Done.")],
		});
		const startRes = await h.engine.start({ goal: "quick" });
		if (!startRes.ok) return;
		const runId = startRes.value.runId;
		await settled(h, runId, "completed");

		// Non-existent run
		const missingRes = await h.engine.model?.(
			"00000000-0000-0000-0000-000000000000",
			MODEL_A,
		);
		expect(missingRes?.ok).toBe(false);
		if (missingRes && !missingRes.ok)
			expect(missingRes.error.code).toBe("not_found");

		// Completed run
		const completedRes = await h.engine.model?.(runId, MODEL_A);
		expect(completedRes?.ok).toBe(false);
		if (completedRes && !completedRes.ok)
			expect(completedRes.error.code).toBe("invalid_state");
	});

	it("validates prefer format at run start", async () => {
		const h = engineHarness({ scripts: [reply("Done.")], templates });

		// Reject single agent start with record prefer
		const badSingle = await h.engine.start({
			goal: "bad",
			prefer: { coder: MODEL_A },
		});
		expect(badSingle.ok).toBe(false);
		if (!badSingle.ok) expect(badSingle.error.code).toBe("bad_input");

		// Reject team start with single ModelRef
		const badTeam = await h.engine.start({
			goal: "bad team",
			templateId: "duo",
			prefer: MODEL_A,
		});
		expect(badTeam.ok).toBe(false);
		if (!badTeam.ok) expect(badTeam.error.code).toBe("bad_input");

		// Reject team start with unknown role
		const badRole = await h.engine.start({
			goal: "bad role",
			templateId: "duo",
			prefer: { unknown_role: MODEL_A },
		});
		expect(badRole.ok).toBe(false);
		if (!badRole.ok) expect(badRole.error.code).toBe("bad_input");
	});

	it("validates prefer arguments on engine.model calls", async () => {
		const h = engineHarness({ scripts: [reply("Done.")], templates });
		const startRes = await h.engine.start({ goal: "valid single" });
		if (!startRes.ok) return;
		const rId = startRes.value.runId;

		// Reject invalid model payload on engine.model
		const badModel = await h.engine.model?.(rId, {
			providerId: "",
		} as ModelRef);
		expect(badModel?.ok).toBe(false);
		if (badModel && !badModel.ok) expect(badModel.error.code).toBe("bad_input");

		// Reject roleId on single agent run
		const badSingleRole = await h.engine.model?.(rId, MODEL_A, "coder");
		expect(badSingleRole?.ok).toBe(false);
		if (badSingleRole && !badSingleRole.ok)
			expect(badSingleRole.error.code).toBe("bad_input");
	});
});
