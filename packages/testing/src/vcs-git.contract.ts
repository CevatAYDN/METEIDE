import type {
	PolicyVerdict,
	Result,
	VcsError,
	VcsGitAdapter,
	VcsGitInput,
	VcsGitOutput,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for vcs.git@2 (docs/06 tool types, docs/10 Built-in tools).

/**
 * Opens the adapter on a fresh git repository without commits whose policy.check@1
 * always answers `verdict`; `put` writes and `read` reads a file in it (undefined when
 * missing), `remove` deletes one.
 */
export type VcsGitHarness = (verdict: PolicyVerdict["verdict"]) => Promise<{
	readonly adapter: VcsGitAdapter;
	readonly put: (path: string, text: string) => Promise<void>;
	readonly read: (path: string) => Promise<string | undefined>;
	readonly remove: (path: string) => Promise<void>;
	/** Writes a file at an absolute path, such as one inside a worktree. */
	readonly putAt: (absolutePath: string, text: string) => Promise<void>;
	readonly exists: (absolutePath: string) => Promise<boolean>;
	readonly close: () => Promise<void>;
}>;

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const TASK = "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6";
const ctx = { signal: new AbortController().signal };

const value = (r: Result<VcsGitOutput, VcsError>) => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

/** Every vcs.git@2 adapter MUST pass these tests. */
export const vcsGitContract = (name: string, open: VcsGitHarness) =>
	describe(`vcs.git@2 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const repo = async (verdict: PolicyVerdict["verdict"] = "allow") => {
			const h = await open(verdict);
			close = h.close;
			const run = (input: VcsGitInput) => h.adapter.run(input, ctx);
			return { ...h, run };
		};

		it("commits the given paths, then has nothing to commit", async () => {
			const r = await repo();
			await r.put("a.txt", "a\n");
			const status = value(await r.run({ op: "status" }));
			expect(status).toMatchObject({
				op: "status",
				files: [{ path: "a.txt" }],
			});
			const commit = value(
				await r.run({ op: "commit", message: "add a", paths: ["a.txt"] }),
			);
			expect(commit).toMatchObject({
				op: "commit",
				sha: expect.stringMatching(/^[0-9a-f]{40}$/),
			});
			expect(value(await r.run({ op: "status" }))).toMatchObject({ files: [] });
			const again = await r.run({ op: "commit", message: "again" });
			expect(again.ok ? undefined : again.error.code).toBe("nothing_to_commit");
		});

		it("diffs a changed tracked file", async () => {
			const r = await repo();
			await r.put("a.txt", "one\n");
			await r.run({ op: "commit", message: "add a" });
			await r.put("a.txt", "two\n");
			const d = value(await r.run({ op: "diff" }));
			expect(d.op === "diff" && d.diff).toMatch(/-one\n\+two/);
		});

		it("returns the policy's deny and ask for a commit", async () => {
			for (const [verdict, want] of [
				["deny", "denied"],
				["ask", "approval_required"],
			] as const) {
				const r = await repo(verdict);
				await r.put("a.txt", "a\n");
				const c = await r.run({ op: "commit", message: "add a" });
				expect(c.ok ? undefined : c.error).toMatchObject({ code: want });
				await close?.();
				close = undefined;
			}
		});

		it("numbers checkpoints per run and leaves the status as it was", async () => {
			const r = await repo();
			await r.put("a.txt", "a\n");
			const before = value(await r.run({ op: "status" }));
			const one = value(await r.run({ op: "checkpoint.create", runId: RUN }));
			const two = value(await r.run({ op: "checkpoint.create", runId: RUN }));
			expect([one, two]).toMatchObject([
				{ ref: `refs/mete/checkpoints/${RUN}/1` },
				{ ref: `refs/mete/checkpoints/${RUN}/2` },
			]);
			expect(value(await r.run({ op: "status" }))).toEqual(before);
		});

		it("restores the working tree and leaves ignored and protected files alone", async () => {
			const r = await repo();
			await r.put(".gitignore", "ignored.txt\n");
			await r.put("a.txt", "a\n");
			await r.put("b.txt", "b\n");
			await r.run({ op: "commit", message: "base" });
			await r.put("a.txt", "a2\n");
			const cp = value(await r.run({ op: "checkpoint.create", runId: RUN }));
			await r.put("a.txt", "a3\n");
			await r.remove("b.txt");
			await r.put("c.txt", "c\n");
			await r.put("ignored.txt", "keep\n");
			await r.put(".mete/policy.yaml", "autonomy: 1\n");
			const ref = cp.op === "checkpoint.create" ? cp.ref : "";
			expect(value(await r.run({ op: "checkpoint.restore", ref }))).toEqual({
				op: "checkpoint.restore",
				ref,
			});
			expect(await r.read("a.txt")).toBe("a2\n");
			expect(await r.read("b.txt")).toBe("b\n");
			expect(await r.read("c.txt")).toBeUndefined();
			expect(await r.read("ignored.txt")).toBe("keep\n");
			expect(await r.read(".mete/policy.yaml")).toBe("autonomy: 1\n");
		});

		it("prunes a run's checkpoints", async () => {
			const r = await repo();
			await r.put("a.txt", "a\n");
			await r.run({ op: "checkpoint.create", runId: RUN });
			await r.run({ op: "checkpoint.create", runId: RUN });
			expect(
				value(await r.run({ op: "checkpoint.prune", runId: RUN })),
			).toEqual({ op: "checkpoint.prune", removed: 2 });
			const gone = await r.run({
				op: "checkpoint.restore",
				ref: `refs/mete/checkpoints/${RUN}/1`,
			});
			expect(gone.ok ? undefined : gone.error.code).toBe("not_found");
		});

		const worktree = async (r: Awaited<ReturnType<typeof repo>>) => {
			const made = value(
				await r.run({ op: "worktree.create", runId: RUN, taskId: TASK }),
			);
			if (made.op !== "worktree.create") throw new Error("not a worktree");
			return made;
		};

		it("starts a worktree at HEAD, merges its work into the workspace and removes it", async () => {
			const r = await repo();
			await r.put("a.txt", "a\n");
			const base = value(await r.run({ op: "commit", message: "base" }));
			const made = await worktree(r);
			expect(made.branch).toBe(`mete/${RUN}/${TASK}`);
			expect(made.sha).toBe(base.op === "commit" ? base.sha : "");
			expect(await r.exists(made.path)).toBe(true);
			await r.putAt(`${made.path}/b.txt`, "b\n");
			expect(await r.read("b.txt")).toBeUndefined();
			const merged = value(
				await r.run({ op: "merge", runId: RUN, taskId: TASK, message: "task" }),
			);
			expect(merged).toMatchObject({
				op: "merge",
				sha: expect.stringMatching(/^[0-9a-f]{40}$/),
			});
			expect(merged.op === "merge" && merged.sha).not.toBe(made.sha);
			expect(await r.read("b.txt")).toBe("b\n");
			expect(value(await r.run({ op: "status" }))).toMatchObject({ files: [] });
			const gone = { op: "worktree.remove", runId: RUN, taskId: TASK } as const;
			expect(value(await r.run(gone))).toEqual({
				op: "worktree.remove",
				removed: true,
			});
			expect(await r.exists(made.path)).toBe(false);
			expect(value(await r.run(gone))).toEqual({
				op: "worktree.remove",
				removed: false,
			});
		});

		it("returns the worktree a run and task already have instead of failing", async () => {
			const r = await repo();
			await r.put("a.txt", "a\n");
			await r.run({ op: "commit", message: "base" });
			const first = await worktree(r);
			await r.putAt(`${first.path}/b.txt`, "b\n");
			const again = await worktree(r);
			expect(again).toMatchObject({ path: first.path, branch: first.branch });
			expect(await r.exists(`${first.path}/b.txt`)).toBe(true);
		});

		it("refuses a worktree before the first commit", async () => {
			const r = await repo();
			const made = await r.run({
				op: "worktree.create",
				runId: RUN,
				taskId: TASK,
			});
			expect(made.ok ? undefined : made.error.code).toBe("io");
		});

		it("names the files of a merge conflict and leaves the workspace as it was", async () => {
			const r = await repo();
			await r.put("a.txt", "base\n");
			await r.run({ op: "commit", message: "base" });
			const made = await worktree(r);
			await r.putAt(`${made.path}/a.txt`, "task\n");
			await r.put("a.txt", "main\n");
			await r.run({ op: "commit", message: "main" });
			const merged = await r.run({
				op: "merge",
				runId: RUN,
				taskId: TASK,
				message: "task",
			});
			expect(merged.ok ? undefined : merged.error).toMatchObject({
				code: "merge_conflict",
				paths: ["a.txt"],
			});
			expect(await r.read("a.txt")).toBe("main\n");
			expect(value(await r.run({ op: "status" }))).toMatchObject({ files: [] });
		});
	});
