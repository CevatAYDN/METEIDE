import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotStore } from "../../src/infrastructure/snapshot-store.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";

// Remove a run (ADR-143): an ended run goes with its worktrees, branches, checkpoints and rows;
// git goes first, so a refusal leaves the run to remove again.

const DUO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [fs.*@1] }
tasks:
  - { id: build, role: dev, title: Build }
`;

const recordingVcs = (refuse?: string) => {
	const calls: Record<string, unknown>[] = [];
	const run: Tool = async (input) => {
		const i = input as { op: string };
		calls.push(i);
		if (i.op === refuse) return err({ code: "io", message: "git refused" });
		if (i.op === "worktree.create")
			return ok({ op: "worktree.create", path: "/wt", branch: "b", sha: "s" });
		if (i.op === "merge") return ok({ op: "merge", sha: "m" });
		if (i.op === "worktree.remove")
			return ok({ op: "worktree.remove", removed: true });
		if (i.op === "checkpoint.prune")
			return ok({ op: "checkpoint.prune", removed: 1 });
		return ok({ op: "checkpoint.create", ref: "refs/x", sha: "s" });
	};
	return { calls, run };
};

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-remove-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "duo.yaml"), DUO);
});
afterEach(() => rm(root, { recursive: true, force: true }));

type H = ReturnType<typeof engineHarness>;
const ended = async (h: H, templateId?: string) => {
	const r = await h.engine.start({
		goal: "g",
		...(templateId ? { templateId } : {}),
	});
	if (!r.ok) throw new Error(r.error.message);
	const runId = r.value.runId;
	await vi.waitFor(() =>
		expect(h.engine.status(runId)).toMatchObject({
			value: [{ status: "completed" }],
		}),
	);
	return runId;
};
const rows = (h: H, table: string, runId: string) =>
	(
		h.db
			.prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id = ?`)
			.get(runId) as { n: number }
	).n;

describe("remove a run (ADR-143)", () => {
	it("deletes an ended run's checkpoints, snapshots and rows, then says so", async () => {
		const vcs = recordingVcs();
		const prune = vi.fn(async () => {});
		const h = engineHarness({
			scripts: [reply("done")],
			tools: [["vcs.git@2", vcs.run]],
			snapshots: { prune } as unknown as SnapshotStore,
		});
		const runId = await ended(h);
		expect(rows(h, "agents", runId)).toBeGreaterThan(0);
		expect(rows(h, "handoffs", runId)).toBeGreaterThan(0);

		expect(await h.engine.remove?.(runId)).toEqual(ok(undefined));

		expect(vcs.calls).toContainEqual({ op: "checkpoint.prune", runId });
		expect(prune).toHaveBeenCalledWith(runId);
		expect(h.engine.status(runId)).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		expect(rows(h, "agents", runId)).toBe(0);
		expect(rows(h, "handoffs", runId)).toBe(0);
		expect(h.events.at(-1)).toMatchObject({ type: "run.removed", runId });
		expect(await h.engine.transcript?.(runId)).toMatchObject({ ok: false });
	});

	it("removes each task's worktree and its branch, merged or not", async () => {
		const vcs = recordingVcs();
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [["vcs.git@2", vcs.run]],
			templates,
		});
		const runId = await ended(h, "duo");
		vcs.calls.length = 0;

		expect(await h.engine.remove?.(runId)).toEqual(ok(undefined));

		// The worktree is named by the task's id, which events carry, not by its key in the template.
		const created = h.events.find((e) => e.type === "task.created");
		const removed = vcs.calls.filter((c) => c.op === "worktree.remove");
		expect(removed).toEqual([
			{ op: "worktree.remove", runId, taskId: created?.taskId, force: true },
		]);
	});

	it("removes the worktree of each attempt of a best-of-N task (ADR-162)", async () => {
		await writeFile(
			join(templates.builtIn, "duo.yaml"),
			DUO.replace(
				"title: Build }",
				"title: Build, attempts: { n: 2, distinct_families: false, judge_tier: reasoning } }",
			),
		);
		const vcs = recordingVcs();
		const h = engineHarness({
			scripts: [reply("built"), reply("built again")],
			tools: [["vcs.git@2", vcs.run]],
			templates,
		});
		const runId = await ended(h, "duo");
		const made = vcs.calls
			.filter((c) => c.op === "worktree.create")
			.map((c) => c.taskId);
		vcs.calls.length = 0;

		expect(await h.engine.remove?.(runId)).toEqual(ok(undefined));

		const removed = vcs.calls
			.filter((c) => c.op === "worktree.remove")
			.map((c) => c.taskId);
		expect(made).toHaveLength(2);
		expect(removed).toEqual(made);
	});

	it("keeps the run when git refuses, so it can be removed again", async () => {
		const vcs = recordingVcs("checkpoint.prune");
		const h = engineHarness({
			scripts: [reply("done")],
			tools: [["vcs.git@2", vcs.run]],
		});
		const runId = await ended(h);

		expect(await h.engine.remove?.(runId)).toMatchObject({
			ok: false,
			error: { code: "failed" },
		});
		expect(h.engine.status(runId)).toMatchObject({ ok: true });
		expect(h.events.map((e) => e.type)).not.toContain("run.removed");
	});

	it("refuses a run that has not ended and one it does not know", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		const r = await h.engine.start({ goal: "g" });
		if (!r.ok) throw new Error(r.error.message);
		await h.engine.pause(r.value.runId);

		expect(await h.engine.remove?.(r.value.runId)).toMatchObject({
			ok: false,
			error: { code: "invalid_state", status: "paused" },
		});
		expect(await h.engine.remove?.(randomUUID())).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
	});
});
