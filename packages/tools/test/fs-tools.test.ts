import { lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	ok,
	type PolicyCheckAdapter,
	type PolicyCheckInput,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { FsDeps } from "../src/application/fs-common.js";
import {
	globTool,
	grepTool,
	listTool,
	readFileTool,
} from "../src/application/fs-read.js";
import { editTool, writeTool } from "../src/application/fs-write.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(() => ws.close());

const ctx = {
	signal: new AbortController().signal,
	runId: "r1",
	tainted: true,
};
const code = <T>(r: Result<T, ToolError>) => (r.ok ? "ok" : r.error.code);

const setup = async (policy: PolicyCheckAdapter | undefined = undefined) => {
	ws = await tempWorkspace();
	const asked: PolicyCheckInput[] = [];
	const recording: PolicyCheckAdapter = {
		check: (i) => {
			asked.push(i);
			return ok({ verdict: "allow", rule: "test" });
		},
	};
	const deps: FsDeps = {
		adapterId: "tools-fs",
		workspaceDir: ws.workspaceDir,
		worktreesDir: join(ws.globalDir, "worktrees"),
		policy: () => policy ?? recording,
	};
	return { deps, asked };
};

describe("fs tools beyond the kit", () => {
	it("sends writes outside the boundary to policy as fs.write.outside with the caller", async () => {
		const { deps, asked } = await setup();
		const out = join(ws.globalDir, "elsewhere.txt");
		expect(code(await writeTool(deps, { path: out, content: "x" }, ctx))).toBe(
			"ok",
		);
		expect(await readFile(out, "utf8")).toBe("x");
		expect(asked[0]).toMatchObject({
			action: "fs.write.outside",
			capability: "fs.write@1",
			adapterId: "tools-fs",
			path: out,
			runId: "r1",
			tainted: true,
		});
		await writeTool(deps, { path: "a.txt", delete: true }, ctx);
		await editTool(deps, { path: "a.txt", oldStr: "x", newStr: "y" }, ctx);
		expect(asked.slice(1).map((a) => [a.action, a.capability])).toEqual([
			["fs.delete", "fs.write@1"],
			["fs.write", "fs.edit@1"],
		]);
	});

	it("refuses reads outside, also through a link that leaves the workspace", async () => {
		const { deps } = await setup();
		await ws.put("secret.txt", "s", ws.globalDir);
		await symlink(ws.globalDir, join(ws.workspaceDir, "link"), "junction");
		expect(code(await readFileTool(deps, { path: "link/secret.txt" }))).toBe(
			"outside_workspace",
		);
		expect(code(await listTool(deps, { path: "link" }, ctx))).toBe(
			"outside_workspace",
		);
	});

	it("deletes a link itself, never the file it points to", async (t) => {
		const { deps, asked } = await setup();
		const target = join(ws.workspaceDir, "target.txt");
		await ws.put("target.txt", "keep");
		const made = await symlink(target, join(ws.workspaceDir, "l.txt"), "file")
			.then(() => true)
			.catch(() => false); // Windows without Developer Mode refuses file links
		if (!made) t.skip();
		const del = { path: "l.txt", delete: true as const };
		expect(code(await writeTool(deps, del, ctx))).toBe("ok");
		expect(await readFile(target, "utf8")).toBe("keep");
		await expect(lstat(join(ws.workspaceDir, "l.txt"))).rejects.toThrow();
		expect(asked[0]?.path).toBe(target);
	});

	it.runIf(process.platform === "win32")(
		"refuses an NTFS stream name, which would bypass the protected paths",
		async () => {
			const { deps, asked } = await setup();
			const write = { path: ".mete/bindings.yaml::$DATA", content: "x" };
			expect(code(await writeTool(deps, write, ctx))).toBe("bad_input");
			expect(code(await readFileTool(deps, { path: "a.txt:s" }))).toBe(
				"bad_input",
			);
			expect(asked).toEqual([]);
		},
	);

	it("answers bad_input for a NUL byte in a grep pattern or glob", async () => {
		const { deps } = await setup();
		await ws.put("a.txt", "a\n");
		for (const input of [
			{ pattern: "a\u0000" },
			{ pattern: "a", glob: "*\u0000" },
		])
			expect(code(await grepTool(deps, input, ctx))).toBe("bad_input");
	});

	it("reads and lists inside a worktree", async () => {
		const { deps } = await setup();
		const tree = join(ws.globalDir, "worktrees", "w1");
		await ws.put("src/a.ts", "a\n", tree);
		expect(
			code(await readFileTool(deps, { path: join(tree, "src/a.ts") })),
		).toBe("ok");
		const r = await listTool(deps, { path: tree }, ctx);
		expect(r.ok && r.value.paths).toEqual([
			`${tree.replaceAll("\\", "/")}/src/`,
		]);
	});

	it("refuses an ignored folder, a file as a folder and a missing folder", async () => {
		const { deps } = await setup();
		await ws.put("secrets/k.txt", "k");
		await ws.put("a.txt", "a");
		expect(code(await listTool(deps, { path: "secrets" }, ctx))).toBe(
			"ignored",
		);
		expect(
			code(await globTool(deps, { pattern: "*", path: "secrets" }, ctx)),
		).toBe("ignored");
		expect(code(await listTool(deps, { path: "a.txt" }, ctx))).toBe(
			"bad_input",
		);
		expect(code(await listTool(deps, { path: "nope" }, ctx))).toBe("not_found");
	});

	it("globs below a folder and rejects bad input", async () => {
		const { deps } = await setup();
		await ws.put("src/a.ts", "a");
		await ws.put("b.ts", "b");
		const r = await globTool(deps, { pattern: "*.ts", path: "src" }, ctx);
		expect(r.ok && r.value.paths).toEqual(["src/a.ts"]);
		expect(code(await readFileTool(deps, { path: 3 }))).toBe("bad_input");
		await mkdir(join(ws.workspaceDir, "dir"));
		expect(code(await readFileTool(deps, { path: "dir" }))).toBe(
			"is_directory",
		);
		expect(
			code(await writeTool(deps, { path: "dir", delete: true }, ctx)),
		).toBe("is_directory");
	});

	it("denies writes when policy.check@1 is missing or its audit fails", async () => {
		const { deps } = await setup();
		const none = { ...deps, policy: () => undefined };
		const r = await writeTool(none, { path: "a.txt", content: "x" }, ctx);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "denied",
			rule: "capability_missing",
		});
		const broken: FsDeps = {
			...deps,
			policy: () => ({
				check: () => ({
					ok: false,
					error: { code: "audit_failed", message: "disk full" },
				}),
			}),
		};
		const b = await writeTool(broken, { path: "a.txt", content: "x" }, ctx);
		expect(b.ok ? undefined : b.error).toMatchObject({
			code: "denied",
			rule: "audit_failed",
		});
	});
});
