import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
	Result,
	ToolAdapter,
	ToolContext,
	VcsGitAdapter,
} from "@mete/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createToolsFsModule,
	createToolsShellModule,
	createVcsGitModule,
} from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { initRepo, isolateGit } from "./helpers/repo.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

// A call with a working folder inside the worktrees folder treats it as the workspace (docs/06,
// ToolContext).

beforeAll(isolateGit);

type Tool = ToolAdapter<unknown, unknown>;

const setup = async () => {
	const ws = await tempWorkspace();
	await initRepo(ws.workspaceDir);
	const { ctx, registry } = toolContext("allow");
	for (const m of [
		createToolsFsModule(ws),
		createToolsShellModule(ws),
		createVcsGitModule(ws),
	]) {
		const r = await m.activate(ctx);
		if (!r.ok) throw new Error(r.error.message);
	}
	const tool = (
		ref: "fs.read@1" | "fs.write@1" | "fs.list@1" | "shell.exec@1",
	) => {
		const c = registry.resolve<Tool>(ref);
		if (!c.ok) throw new Error(`${ref} missing`);
		return c.value[0].impl;
	};
	const vcs = registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!vcs.ok) throw new Error("vcs.git@2 missing");
	const tree = join(ws.globalDir, "worktrees", "r1", "t1");
	await mkdir(tree, { recursive: true });
	const at = (cwd?: string): ToolContext => ({
		signal: new AbortController().signal,
		...(cwd ? { cwd } : {}),
	});
	return { ws, tree, at, tool, vcs: vcs.value[0].impl };
};

const failure = (r: Result<unknown, { readonly code: string }>) =>
	r.ok ? "ok" : r.error.code;

describe("a call with a working folder", () => {
	it("reads, writes and lists relative to it, not to the workspace", async () => {
		const t = await setup();
		const write = t.tool("fs.write@1");
		const out = await write.run(
			{ path: "a.txt", content: "tree\n" },
			t.at(t.tree),
		);
		expect(out.ok).toBe(true);
		expect(
			await t.tool("fs.read@1").run({ path: "a.txt" }, t.at(t.tree)),
		).toMatchObject({ ok: true, value: { content: "tree\n" } });
		expect(
			await t.tool("fs.read@1").run({ path: "a.txt" }, t.at()),
		).toMatchObject({ ok: false, error: { code: "not_found" } });
		expect(
			await t.tool("fs.list@1").run({ path: "." }, t.at(t.tree)),
		).toMatchObject({
			ok: true,
			value: { paths: ["a.txt"] },
		});
		await t.ws.close();
	});

	it("is confined to its folder: the workspace and another worktree are outside", async () => {
		const t = await setup();
		const other = await t.ws.put(
			"b.txt",
			"other\n",
			join(t.ws.globalDir, "worktrees", "r1", "t2"),
		);
		const mine = await t.ws.put("x.txt", "ws\n");
		const read = t.tool("fs.read@1");
		expect(failure(await read.run({ path: mine }, t.at(t.tree)))).toBe(
			"outside_workspace",
		);
		expect(failure(await read.run({ path: other }, t.at(t.tree)))).toBe(
			"outside_workspace",
		);
		await t.ws.close();
	});

	it("refuses a folder that is not inside the worktrees folder", async () => {
		const t = await setup();
		for (const cwd of [t.ws.workspaceDir, join(t.ws.globalDir, "worktrees")]) {
			expect(
				failure(await t.tool("fs.list@1").run({ path: "." }, t.at(cwd))),
			).toBe("bad_input");
			expect(
				failure(
					await t.tool("shell.exec@1").run({ command: "echo x" }, t.at(cwd)),
				),
			).toBe("bad_input");
			const s = await t.vcs.run({ op: "status" }, t.at(cwd));
			expect(failure(s)).toBe("bad_input");
		}
		await t.ws.close();
	});

	it("reads .meteignore from the real workspace, anchored in the worktree", async () => {
		const t = await setup();
		await t.ws.put(".meteignore", "secret.txt\n/only-root.txt\n");
		await t.ws.put("secret.txt", "s\n", t.tree);
		await t.ws.put("only-root.txt", "r\n", t.tree);
		await t.ws.put("sub/only-root.txt", "n\n", t.tree);
		const read = t.tool("fs.read@1");
		for (const path of ["secret.txt", "only-root.txt"])
			expect(failure(await read.run({ path }, t.at(t.tree))), path).toBe(
				"ignored",
			);
		expect(
			failure(await read.run({ path: "sub/only-root.txt" }, t.at(t.tree))),
		).toBe("ok");
		await t.ws.close();
	});

	it("runs shell commands in it", async () => {
		const t = await setup();
		const out = await t
			.tool("shell.exec@1")
			.run({ command: 'node -p "process.cwd()"' }, t.at(t.tree));
		expect(out).toMatchObject({ ok: true, value: { exitCode: 0 } });
		expect(
			out.ok && String((out.value as { stdout: string }).stdout).trim(),
		).toBe(t.tree);
		await t.ws.close();
	});

	it("runs git in its worktree, and keeps worktree and merge for the repository", async () => {
		const t = await setup();
		await t.ws.put("a.txt", "a\n");
		await t.vcs.run({ op: "commit", message: "base" }, t.at());
		const ids = {
			runId: "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a",
			taskId: "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6",
		};
		const made = await t.vcs.run({ op: "worktree.create", ...ids }, t.at());
		if (!made.ok || made.value.op !== "worktree.create")
			throw new Error("no worktree");
		const cwd = made.value.path;
		await t
			.tool("fs.write@1")
			.run({ path: "n.txt", content: "n\n" }, t.at(cwd));
		const inTree = await t.vcs.run({ op: "status" }, t.at(cwd));
		expect(inTree).toMatchObject({
			ok: true,
			value: { files: [{ path: "n.txt" }] },
		});
		expect(await t.vcs.run({ op: "status" }, t.at())).toMatchObject({
			ok: true,
			value: { files: [] },
		});
		const merge = { op: "merge", ...ids, message: "m" } as const;
		expect(failure(await t.vcs.run(merge, t.at(cwd)))).toBe("bad_input");
		await t.ws.close();
	});
});
