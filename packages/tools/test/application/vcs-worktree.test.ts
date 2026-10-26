import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok } from "@mete/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	createWorktree,
	removeWorktree,
} from "../../src/application/vcs-worktree.js";
import { type Git, gitAt } from "../../src/infrastructure/git.js";
import { initRepo, isolateGit } from "../helpers/repo.js";
import { tempWorkspace } from "../infrastructure/workspace.js";

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const TASK1 = "1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e";
const TASK2 = "2c3d4e5f-6a7b-8c9d-0e1f-2a3b4c5d6e7f";

beforeAll(isolateGit);

let ws: Awaited<ReturnType<typeof tempWorkspace>> | undefined;
afterEach(async () => {
	await ws?.close();
	ws = undefined;
});

const exists = (p: string) =>
	access(p).then(
		() => true,
		() => false,
	);

const setup = async () => {
	const w = await tempWorkspace();
	ws = w;
	await initRepo(w.workspaceDir);
	const git = gitAt(w.workspaceDir);
	await w.put("README.md", "# test\n");
	await git(["add", "README.md"]);
	await git([
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"-m",
		"initial commit",
	]);
	const deps = { worktreesDir: join(w.globalDir, "worktrees") };
	return { w, git, deps };
};

describe("vcs-worktree cleanup", () => {
	it("removes worktree completely including nested ignored subdirectories like node_modules", async () => {
		const { git, deps } = await setup();
		const created = await createWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(created.ok).toBe(true);
		if (!created.ok || created.value.op !== "worktree.create")
			throw new Error("worktree not created");

		const wtDir = created.value.path;
		const nmDir = join(wtDir, "node_modules", "some-package");
		await mkdir(nmDir, { recursive: true });
		await writeFile(join(nmDir, "index.js"), "module.exports = 42;\n");
		await writeFile(join(wtDir, ".gitignore"), "node_modules/\n");
		await writeFile(join(wtDir, "src.js"), "console.log(1);\n");

		expect(await exists(join(nmDir, "index.js"))).toBe(true);
		expect(await exists(wtDir)).toBe(true);

		const removed = await removeWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(removed).toEqual(ok({ op: "worktree.remove", removed: true }));

		expect(await exists(wtDir)).toBe(false);
		expect(await exists(join(deps.worktreesDir, RUN))).toBe(false);

		const again = await removeWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(again).toEqual(ok({ op: "worktree.remove", removed: false }));
	});

	it("removes the folder and the branch when git refuses to remove the worktree", async () => {
		// Windows git fails a removal whose path is longer than MAX_PATH (ADR-123).
		const { git, deps } = await setup();
		const created = await createWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(created.ok).toBe(true);
		if (!created.ok || created.value.op !== "worktree.create")
			throw new Error("worktree not created");

		const wtDir = created.value.path;
		await writeFile(join(wtDir, "src.js"), "console.log(1);\n");
		const refusing: Git = async (args, env) =>
			args.includes("worktree") && args.includes("remove")
				? err({ code: "io", message: "fatal: could not remove worktree" })
				: git(args, env);

		const removed = await removeWorktree(deps, refusing, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(removed).toEqual(ok({ op: "worktree.remove", removed: true }));

		expect(await exists(wtDir)).toBe(false);
		expect(await exists(join(deps.worktreesDir, RUN))).toBe(false);
		const branch = await git(["branch", "--list", `mete/${RUN}/${TASK1}`]);
		expect(branch.ok && branch.value.trim()).toBe("");
	});

	it("keeps a junction's target when git refuses the removal and the folder is deleted", async () => {
		const { w, git, deps } = await setup();
		const created = await createWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(created.ok).toBe(true);
		if (!created.ok || created.value.op !== "worktree.create")
			throw new Error("worktree not created");

		const wtDir = created.value.path;
		const outside = join(w.globalDir, "outside-store");
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "keep.txt"), "keep me\n");
		const nmDir = join(wtDir, "node_modules");
		await mkdir(nmDir, { recursive: true });
		await symlink(
			outside,
			join(nmDir, "linked-pkg"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await writeFile(join(wtDir, "src.js"), "console.log(1);\n");
		expect(await exists(join(nmDir, "linked-pkg", "keep.txt"))).toBe(true);

		const refusing: Git = async (args, env) =>
			args.includes("worktree") && args.includes("remove")
				? err({ code: "io", message: "fatal: could not remove worktree" })
				: git(args, env);
		const removed = await removeWorktree(deps, refusing, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(removed).toEqual(ok({ op: "worktree.remove", removed: true }));

		expect(await exists(wtDir)).toBe(false);
		expect(await exists(join(outside, "keep.txt"))).toBe(true);
	});

	it("removes one task worktree with node_modules while keeping sibling task worktrees", async () => {
		const { git, deps } = await setup();
		const wt1 = await createWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		const wt2 = await createWorktree(deps, git, {
			runId: RUN,
			taskId: TASK2,
		});
		expect(wt1.ok && wt2.ok).toBe(true);
		if (!wt1.ok || !wt2.ok) throw new Error("worktrees not created");
		if (
			wt1.value.op !== "worktree.create" ||
			wt2.value.op !== "worktree.create"
		)
			throw new Error("invalid op");

		const nm1 = join(wt1.value.path, "node_modules", "pkg-a");
		const nm2 = join(wt2.value.path, "node_modules", "pkg-b");
		await mkdir(nm1, { recursive: true });
		await mkdir(nm2, { recursive: true });
		await writeFile(join(nm1, "a.js"), "1");
		await writeFile(join(nm2, "b.js"), "2");

		const res1 = await removeWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(res1).toEqual(ok({ op: "worktree.remove", removed: true }));

		expect(await exists(wt1.value.path)).toBe(false);
		expect(await exists(wt2.value.path)).toBe(true);
		expect(await exists(join(nm2, "b.js"))).toBe(true);
		expect(await exists(join(deps.worktreesDir, RUN))).toBe(true);

		const res2 = await removeWorktree(deps, git, {
			runId: RUN,
			taskId: TASK2,
		});
		expect(res2).toEqual(ok({ op: "worktree.remove", removed: true }));

		expect(await exists(wt2.value.path)).toBe(false);
		expect(await exists(join(deps.worktreesDir, RUN))).toBe(false);
	});

	it("removes worktree with symlinks/junctions in node_modules without removing link targets", async () => {
		const { w, git, deps } = await setup();
		const created = await createWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(created.ok).toBe(true);
		if (!created.ok || created.value.op !== "worktree.create")
			throw new Error("worktree not created");

		const wtDir = created.value.path;
		const externalStore = join(w.globalDir, "external-store");
		await mkdir(externalStore, { recursive: true });
		await writeFile(
			join(externalStore, "target-pkg.js"),
			"module.exports = 'real';\n",
		);

		const nmDir = join(wtDir, "node_modules");
		await mkdir(nmDir, { recursive: true });
		const linkType = process.platform === "win32" ? "junction" : "dir";
		await symlink(externalStore, join(nmDir, "linked-pkg"), linkType);

		expect(await exists(join(nmDir, "linked-pkg", "target-pkg.js"))).toBe(true);

		const removed = await removeWorktree(deps, git, {
			runId: RUN,
			taskId: TASK1,
		});
		expect(removed).toEqual(ok({ op: "worktree.remove", removed: true }));

		expect(await exists(wtDir)).toBe(false);
		expect(await exists(join(deps.worktreesDir, RUN))).toBe(false);
		expect(await exists(join(externalStore, "target-pkg.js"))).toBe(true);
	});
});
