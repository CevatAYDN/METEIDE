import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
	Result,
	ToolContext,
	VcsError,
	VcsGitAdapter,
	VcsGitOutput,
} from "@mete/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createVcsGitModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { initRepo, isolateGit } from "./helpers/repo.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

const sh = promisify(execFile);
const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const ctx: ToolContext = { signal: new AbortController().signal };
const input = { op: "checkpoint.create", runId: RUN } as const;
const prefix = `refs/mete/checkpoints/${RUN}`;
const git = async (cwd: string, ...args: string[]) =>
	(await sh("git", args, { cwd })).stdout.trim();
const refOf = (out: Result<VcsGitOutput, VcsError>) => {
	if (!out.ok || out.value.op !== "checkpoint.create")
		throw new Error(out.ok ? out.value.op : out.error.message);
	return out.value.ref;
};

beforeAll(isolateGit);
let ws: Awaited<ReturnType<typeof tempWorkspace>> | undefined;
afterEach(async () => {
	await ws?.close();
	ws = undefined;
});

const setup = async () => {
	const w = await tempWorkspace();
	ws = w;
	await initRepo(w.workspaceDir);
	await w.put("base.txt", "base\n");
	await git(w.workspaceDir, "add", "base.txt");
	await git(w.workspaceDir, "commit", "-q", "-m", "base");
	const { ctx: moduleCtx, registry } = toolContext("allow");
	expect(await createVcsGitModule(w).activate(moduleCtx)).toMatchObject({
		ok: true,
	});
	const found = registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!found.ok) throw new Error("vcs.git@2 missing");
	const vcs = found.value[0].impl;
	const roots = [w.workspaceDir];
	for (const taskId of [
		"1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6",
		"2c3d4e5f-6a7b-48c9-80e1-f2a3b4c5d6e7",
	]) {
		const made = await vcs.run(
			{ op: "worktree.create", runId: RUN, taskId },
			ctx,
		);
		if (!made.ok || made.value.op !== "worktree.create")
			throw new Error("worktree not created");
		roots.push(made.value.path);
	}
	for (const [i, root] of roots.entries()) {
		await w.put("staged.txt", `staged ${i}\n`, root);
		await git(root, "add", "staged.txt");
		await w.put("staged.txt", `working ${i}\n`, root);
		await w.put("untracked.txt", `untracked ${i}\n`, root);
	}
	const create = (root: string) =>
		vcs.run(input, root === w.workspaceDir ? ctx : { ...ctx, cwd: root });
	return { w, roots, create };
};

const userState = async (root: string) => ({
	head: await git(root, "rev-parse", "HEAD"),
	branch: await git(root, "symbolic-ref", "HEAD"),
	index: await readFile(
		resolve(root, await git(root, "rev-parse", "--git-path", "index")),
	),
});

describe("real Git checkpoint allocation across checkouts", () => {
	it("allocates unique refs for concurrent workspace and two worktree creates, without moving user state", async () => {
		const { w, roots, create } = await setup();
		const before = await Promise.all(roots.map(userState));
		const refs = (await Promise.all(roots.map(create))).map(refOf);
		expect(new Set(refs).size).toBe(3);
		expect([...refs].sort()).toEqual([
			`${prefix}/1`,
			`${prefix}/2`,
			`${prefix}/3`,
		]);
		for (const [i, ref] of refs.entries()) {
			expect(await git(w.workspaceDir, "show", `${ref}:staged.txt`)).toBe(
				`working ${i}`,
			);
			expect(await git(w.workspaceDir, "show", `${ref}:untracked.txt`)).toBe(
				`untracked ${i}`,
			);
		}
		expect(await Promise.all(roots.map(userState))).toEqual(before);
	});

	it("preserves a real ref-lock failure and allocates successfully afterwards", async () => {
		const { w, roots, create } = await setup();
		const before = await Promise.all(roots.map(userState));
		const lock = join(
			w.workspaceDir,
			".git",
			"refs",
			"mete",
			"checkpoints",
			RUN,
			"1.lock",
		);
		await mkdir(dirname(lock), { recursive: true });
		await writeFile(lock, "");
		const firstTree = roots[1];
		if (!firstTree) throw new Error("worktree missing");
		const failed = await create(firstTree);
		expect(failed).toMatchObject({ ok: false, error: { code: "io" } });
		expect(failed.ok ? "" : failed.error.message).toContain("update-ref");
		await rm(lock);
		const refs = (await Promise.all(roots.map(create))).map(refOf);
		expect([...refs].sort()).toEqual([
			`${prefix}/1`,
			`${prefix}/2`,
			`${prefix}/3`,
		]);
		expect(
			await git(
				w.workspaceDir,
				"for-each-ref",
				"--format=%(refname)",
				`${prefix}/`,
			),
		).toBe([...refs].sort().join("\n"));
		expect(await Promise.all(roots.map(userState))).toEqual(before);
	});
});
