import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, VcsGitInputSchema } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";
import { gatedReply } from "../helpers/scheduler.js";

type Harness = ReturnType<typeof engineHarness>;
type Saved = NonNullable<ReturnType<Harness["store"]["load"]>>;
const engines: Harness[] = [];
const roots: string[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	const databases = new Set(engines.map((h) => h.db));
	for (const h of engines.splice(0).reverse()) await h.stop();
	for (const db of databases) db.close();
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
const gate = () => {
	let release = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	releases.push(release);
	return { wait, release };
};

const fixture = async (configured: boolean, clarify = false) => {
	const root = await mkdtemp(join(tmpdir(), "mete-opening-"));
	roots.push(root);
	const templates = { builtIn: join(root, "templates"), workspace: root };
	const worktree = join(root, "worktree");
	await mkdir(templates.builtIn);
	await mkdir(worktree);
	await writeFile(
		join(templates.builtIn, "opening.yaml"),
		`apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: opening, name: Opening, version: 1.0.0 }
pattern: single
roles:
  - { id: writer, name: Writer, goal: Write, tier: coder, capabilities: [fs.write@1] }
tasks:
  - { id: a, role: writer, title: Task A${clarify ? ", before_start: { clarify_with: human }" : ""} }
`,
	);
	const checkpoint = gate();
	const setup = gate();
	const model = gatedReply("old process");
	releases.push(model.release);
	const timeline: string[] = [];
	const opened: Saved[] = [];
	const recordCheckpoint = async (cwd: string | undefined) => {
		if (!cwd) return;
		timeline.push("checkpoint");
		if (!clarify) await checkpoint.wait;
	};
	const vcs: Tool = async (raw, ctx) => {
		const input = VcsGitInputSchema.parse(raw);
		if (input.op === "worktree.create")
			return ok({
				op: input.op,
				path: worktree,
				branch: "fixture",
				sha: "base",
			});
		if (input.op === "checkpoint.create") {
			await recordCheckpoint(ctx.cwd);
			return ok({
				op: input.op,
				ref: `refs/mete/checkpoints/${input.runId}/1`,
				sha: "saved",
			});
		}
		return ok({ op: "merge", sha: "merged" });
	};
	const shell: Tool = async () => {
		timeline.push("setup");
		await setup.wait;
		return ok({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
			os: "test",
			shell: "fixture",
		});
	};
	const tools = [
		["vcs.git@2", vcs],
		["shell.exec@1", shell],
	] as const;
	const h = engineHarness({
		templates,
		tools,
		worktrees: configured ? { setup: "fixture-setup" } : {},
		scripts: clarify ? [reply("Which target?")] : [model.script],
		wrapStore: (store) => ({
			...store,
			save(meta, snapshot) {
				store.save(meta, snapshot);
				const entry = snapshot.context.team?.tasks.a;
				if (!entry?.context.worktree || !entry.context.agentId) return;
				const persisted = store.load(meta.id);
				if (persisted) opened.push(persisted);
			},
		}),
	});
	engines.push(h);
	const started = await h.engine.start({
		goal: "open atomically",
		templateId: "opening",
	});
	if (!started.ok) throw new Error(started.error.message);
	return {
		h,
		runId: started.value.runId,
		templates,
		tools,
		worktree,
		opened,
		timeline,
		checkpoint,
		setup,
		model,
	};
};

describe("atomic setup opening", () => {
	it.each([true, false])(
		"recovers the first opened save with configured setup=%s without losing pending or rewriting legacy absence",
		async (configured) => {
			const f = await fixture(configured);
			await vi.waitFor(() => expect(f.opened.length).toBeGreaterThan(0));
			const first = f.opened[0];
			if (!first) throw new Error("opening save missing");
			const entry = first.snapshot.context.team?.tasks.a;
			expect(entry).toMatchObject({
				status: "in_progress",
				context: { worktree: f.worktree },
				session: { turns: 0, checkpointed: -1 },
			});
			expect(entry?.context.agentId).toBeTruthy();
			expect(entry?.messages.length).toBeGreaterThan(0);
			expect(entry?.setup).toBe(configured ? "pending" : undefined);
			const stopping = f.h.stop();
			f.checkpoint.release();
			f.setup.release();
			f.model.release();
			await stopping;
			f.h.store.save(first.meta, first.snapshot);
			f.timeline.length = 0;
			const later = engineHarness({
				db: f.h.db,
				templates: f.templates,
				tools: f.tools,
				worktrees: { setup: "fixture-setup" },
				scripts: [
					async function* () {
						f.timeline.push("model");
						yield* reply("done");
					},
				],
			});
			engines.push(later);
			later.recover();
			expect(
				later.store.load(f.runId)?.snapshot.context.team?.tasks.a?.setup,
			).toBe(configured ? "pending" : undefined);
			expect((await later.engine.resume(f.runId)).ok).toBe(true);
			await vi.waitFor(() =>
				expect(later.store.load(f.runId)?.snapshot.value).toBe("completed"),
			);
			expect(f.timeline).toEqual(
				configured ? ["checkpoint", "setup", "model"] : ["model"],
			);
			expect(later.requests).toHaveLength(1);
		},
	);

	it("finishes configured setup before asking the human a clarification question", async () => {
		const f = await fixture(true, true);
		await vi.waitFor(() => expect(f.timeline).toEqual(["checkpoint", "setup"]));
		expect(f.h.store.load(f.runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
			"running",
		);
		expect(f.h.requests).toEqual([]);
		f.setup.release();
		await vi.waitFor(() => expect(f.h.requests).toHaveLength(1));
		expect(f.h.store.load(f.runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
			"done",
		);
		await vi.waitFor(() =>
			expect(
				f.h.store.load(f.runId)?.snapshot.context.team?.tasks.a?.context
					.clarify,
			).toBe("asked"),
		);
	});
});
