import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	ok,
	type Result,
	type VcsError,
	type VcsGitOutput,
} from "@mete/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type VcsDeps, vcsTool } from "../src/application/vcs.js";
import { createVcsGitModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { initRepo, isolateGit } from "./helpers/repo.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

const sh = promisify(execFile);
const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const ctx = { signal: new AbortController().signal };

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
	const deps: VcsDeps = {
		adapterId: "vcs-git",
		workspaceDir: w.workspaceDir,
		worktreesDir: join(w.globalDir, "worktrees"),
		policy: () => ({ check: () => ok({ verdict: "allow", rule: "test" }) }),
		root: w.workspaceDir,
	};
	const git = async (...args: string[]) =>
		(await sh("git", args, { cwd: w.workspaceDir })).stdout.trim();
	const run = (input: unknown) => vcsTool(deps, input, ctx);
	return { w, git, run };
};

const refOf = (r: Result<VcsGitOutput, VcsError>) => {
	if (!r.ok || r.value.op !== "checkpoint.create")
		throw new Error(r.ok ? r.value.op : r.error.message);
	return r.value.ref;
};

describe("vcs-git beyond the kit", () => {
	it("does not activate outside a repository", async () => {
		const w = await tempWorkspace();
		ws = w;
		const r = await createVcsGitModule(w).activate(toolContext("allow").ctx);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "activation_failed",
			moduleId: "vcs-git",
		});
	});

	it("keeps HEAD and the user's staged changes through create and restore", async () => {
		const { w, git, run } = await setup();
		await w.put("a.txt", "a\n");
		await git("add", "a.txt");
		await git("commit", "-q", "-m", "base");
		await w.put("s.txt", "staged\n");
		await git("add", "s.txt");
		const head = await git("rev-parse", "HEAD");
		const ref = refOf(await run({ op: "checkpoint.create", runId: RUN }));
		await w.put("a.txt", "changed\n");
		expect((await run({ op: "checkpoint.restore", ref })).ok).toBe(true);
		expect(await git("rev-parse", "HEAD")).toBe(head);
		expect(await git("diff", "--cached", "--name-only")).toBe("s.txt");
		expect(await git("branch", "--list")).toBe("* main");
		expect(await readFile(join(w.workspaceDir, "a.txt"), "utf8")).toBe("a\n");
	});

	it("checkpoints before the first commit and restores exact CRLF bytes", async () => {
		const { w, git, run } = await setup();
		await git("config", "core.autocrlf", "true");
		await w.put("c.txt", "one\r\ntwo\n");
		const ref = refOf(await run({ op: "checkpoint.create", runId: RUN }));
		await w.put("c.txt", "x\n");
		expect((await run({ op: "checkpoint.restore", ref })).ok).toBe(true);
		expect(await readFile(join(w.workspaceDir, "c.txt"), "utf8")).toBe(
			"one\r\ntwo\n",
		);
	});

	it("never restores the protected files from the checkpoint", async () => {
		const { w, git, run } = await setup();
		await w.put(".mete/policy.yaml", "autonomy: 2\n");
		await w.put(".meteignore", "build/\n");
		await git("add", "-A");
		await git("commit", "-q", "-m", "base");
		const ref = refOf(await run({ op: "checkpoint.create", runId: RUN }));
		await w.put(".mete/policy.yaml", "autonomy: 1\n");
		await w.put(".meteignore", "!.env\n");
		expect((await run({ op: "checkpoint.restore", ref })).ok).toBe(true);
		const read = (p: string) => readFile(join(w.workspaceDir, p), "utf8");
		expect(await read(".mete/policy.yaml")).toBe("autonomy: 1\n");
		expect(await read(".meteignore")).toBe("!.env\n");
	});

	// ADR-072: every .mete yaml file and team template is kept like the policy, and an agent's own
	// output under .mete is restored like any other file.
	it("keeps every .mete yaml file and team template as it is, and still undoes artifacts", async () => {
		const { w, git, run } = await setup();
		await w.put(".mete/privacy.yaml", "allowTraining: false\n");
		await w.put(".mete/teams/kept.yaml", "id: kept\n");
		await w.put("a.txt", "a\n");
		await git("add", "-A");
		await git("commit", "-q", "-m", "base");
		const ref = refOf(await run({ op: "checkpoint.create", runId: RUN }));
		await w.put(".mete/privacy.yaml", "allowTraining: true\n");
		await w.put(".mete/teams/kept.yaml", "id: changed\n");
		await w.put(".mete/teams/new.yaml", "id: new\n");
		await w.put(".mete/artifacts/out.md", "out\n");
		await w.put("a.txt", "changed\n");
		expect((await run({ op: "checkpoint.restore", ref })).ok).toBe(true);
		const read = (p: string) => readFile(join(w.workspaceDir, p), "utf8");
		expect(await read(".mete/privacy.yaml")).toBe("allowTraining: true\n");
		expect(await read(".mete/teams/kept.yaml")).toBe("id: changed\n");
		expect(await read(".mete/teams/new.yaml")).toBe("id: new\n");
		expect(await read("a.txt")).toBe("a\n");
		await expect(read(".mete/artifacts/out.md")).rejects.toThrow();
	});

	it("restores a folder that became a file, and a file that became a folder", async () => {
		const { w, run } = await setup();
		await w.put("d/b.txt", "b\n");
		await w.put("f", "f\n");
		const ref = refOf(await run({ op: "checkpoint.create", runId: RUN }));
		await rm(join(w.workspaceDir, "d"), { recursive: true });
		await w.put("d", "now a file\n");
		await rm(join(w.workspaceDir, "f"));
		await w.put("f/x.txt", "x\n");
		expect(await run({ op: "checkpoint.restore", ref })).toEqual(
			ok({ op: "checkpoint.restore", ref }),
		);
		const read = (p: string) => readFile(join(w.workspaceDir, p), "utf8");
		expect(await read("d/b.txt")).toBe("b\n");
		expect(await read("f")).toBe("f\n");
	});

	it("commits only the given paths and refuses an option as a diff ref", async () => {
		const { w, git, run } = await setup();
		await w.put("a.txt", "a\n");
		await w.put("b.txt", "b\n");
		expect(
			(await run({ op: "commit", message: "a only", paths: ["a.txt"] })).ok,
		).toBe(true);
		expect(await git("ls-files")).toBe("a.txt");
		const bad = await run({ op: "diff", ref: "--output=x" });
		expect(bad.ok ? undefined : bad.error.code).toBe("bad_input");
		const status = await run({ op: "status" });
		expect(status.ok && status.value).toEqual({
			op: "status",
			branch: "main",
			files: [{ path: "b.txt", index: "?", worktree: "?" }],
		});
	});
});
