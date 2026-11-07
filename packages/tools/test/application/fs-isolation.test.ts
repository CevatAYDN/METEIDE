import { lstat, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	ok,
	type PolicyCheckInput,
	type ToolAdapter,
	type ToolIsolationInput,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type FsDeps, scoped } from "../../src/application/fs-common.js";
import { createFsIsolation } from "../../src/application/fs-isolation.js";
import { editTool, writeTool } from "../../src/application/fs-write.js";
import { createToolsFsModule } from "../../src/module.js";
import { toolContext } from "../helpers/context.js";
import { tempWorkspace } from "../infrastructure/workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(async () => {
	await ws?.close();
});
const signal = new AbortController().signal;
const setup = async () => {
	ws = await tempWorkspace();
	const tree = join(ws.globalDir, "worktrees", "run", "task");
	await mkdir(tree, { recursive: true });
	const asked: PolicyCheckInput[] = [];
	const deps: FsDeps = {
		adapterId: "tools-fs",
		workspaceDir: ws.workspaceDir,
		worktreesDir: join(ws.globalDir, "worktrees"),
		policy: () => ({
			check: (input) => {
				asked.push(input);
				return ok({ verdict: "allow", rule: "test" });
			},
		}),
	};
	const call: ToolIsolationInput = {
		capability: "fs.write@1",
		adapterId: deps.adapterId,
		input: { path: "new/sub.txt", content: "new" },
		cwd: tree,
	};
	return { tree, deps, asked, call, inspect: createFsIsolation(deps).inspect };
};

describe("native file isolation", () => {
	it("claims a canonical root without writing files or asking policy", async () => {
		const t = await setup();
		const alias = join(t.deps.worktreesDir, "alias");
		await symlink(t.tree, alias, "junction");
		for (const input of [
			t.call.input,
			{ path: "gone.txt", delete: true },
			{ path: join(t.tree, "absolute.txt"), content: "x" },
		])
			expect(await t.inspect({ ...t.call, cwd: alias, input }, signal)).toEqual(
				{
					ok: true,
					value: { scope: "worktree", root: await realpath(t.tree) },
				},
			);
		expect(
			await t.inspect(
				{
					...t.call,
					capability: "fs.edit@1",
					input: { path: "edit.txt", oldStr: "a", newStr: "b" },
				},
				signal,
			),
		).toMatchObject({ ok: true, value: { scope: "worktree" } });
		expect(t.asked).toEqual([]);
		await expect(lstat(join(t.tree, "new"))).rejects.toThrow();
	});

	it("keeps unsupported, mismatched and missing cwd calls workspace-scoped", async () => {
		const t = await setup();
		const { cwd: _cwd, ...withoutCwd } = t.call;
		for (const call of [
			withoutCwd,
			{ ...t.call, adapterId: "other" },
			{ ...t.call, capability: "shell.exec@1" as const },
			{ ...t.call, capability: "fs.read@1" as const },
		])
			expect(await t.inspect(call, signal)).toEqual({
				ok: true,
				value: { scope: "workspace" },
			});
	});

	it("requires an existing directory inside the canonical worktrees root", async () => {
		const t = await setup();
		const file = await ws.put("file.txt", "x", t.tree);
		const link = join(t.deps.worktreesDir, "outside-link");
		await symlink(ws.workspaceDir, link, "junction");
		for (const cwd of [
			ws.workspaceDir,
			t.deps.worktreesDir,
			join(t.tree, "missing"),
			file,
			link,
			"relative",
			"",
		]) {
			const result = await t.inspect({ ...t.call, cwd }, signal);
			expect(result).toMatchObject(
				cwd === ""
					? { ok: false, error: { code: "bad_input" } }
					: { ok: true, value: { scope: "workspace" } },
			);
		}
	});

	it("strictly validates both the descriptor envelope and native arguments", async () => {
		const t = await setup();
		expect(
			await t.inspect({ ...t.call, extra: true } as ToolIsolationInput, signal),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
		for (const input of [
			{ path: "x", content: 3 },
			{ path: "", content: "x" },
			{ path: "x", content: "x", extra: true },
			{ path: "x", content: "x", delete: true },
			{ path: "x\u0000", content: "x" },
		])
			expect(await t.inspect({ ...t.call, input }, signal)).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		expect(
			await t.inspect(
				{
					...t.call,
					capability: "fs.edit@1",
					input: { path: "x", oldStr: "", newStr: "b" },
				},
				signal,
			),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
	});

	it("refuses traversal, absolute and linked escapes even with permissive policy", async () => {
		const t = await setup();
		const other = join(t.deps.worktreesDir, "run", "other");
		const outside = await ws.put("outside.txt", "keep");
		const sibling = await ws.put("sibling.txt", "keep", other);
		await symlink(ws.workspaceDir, join(t.tree, "escape"), "junction");
		await symlink(
			join(ws.workspaceDir, "missing"),
			join(t.tree, "dangling"),
			"junction",
		);
		const d = await scoped(t.deps, { cwd: t.tree, signal });
		if (!d.ok) throw new Error(d.error.message);
		for (const path of [
			join("..", "other", "sibling.txt"),
			outside,
			sibling,
			join("escape", "outside.txt"),
			join("dangling", "new.txt"),
		]) {
			for (const input of [
				{ path, content: "bad" },
				{ path, delete: true },
			]) {
				expect(await t.inspect({ ...t.call, input }, signal)).toMatchObject({
					ok: true,
					value: { scope: "workspace" },
				});
				expect(await writeTool(d.value, input, { signal })).toMatchObject({
					ok: false,
					error: { code: "outside_workspace" },
				});
			}
			const input = { path, oldStr: "keep", newStr: "bad" };
			expect(
				await t.inspect({ ...t.call, capability: "fs.edit@1", input }, signal),
			).toMatchObject({ ok: true, value: { scope: "workspace" } });
			expect(await editTool(d.value, input, { signal })).toMatchObject({
				ok: false,
				error: { code: "outside_workspace" },
			});
		}
		expect(await readFile(outside, "utf8")).toBe("keep");
		expect(await readFile(sibling, "utf8")).toBe("keep");
		await expect(lstat(join(ws.workspaceDir, "missing"))).rejects.toThrow();
		expect(t.asked).toEqual([]);
	});

	it("preserves ordinary outside-write policy behavior", async () => {
		const t = await setup();
		const path = await ws.put("outside.txt", "keep", ws.globalDir);
		expect(
			await writeTool(t.deps, { path, content: "a" }, { signal }),
		).toMatchObject({ ok: true });
		expect(
			await editTool(t.deps, { path, oldStr: "a", newStr: "b" }, { signal }),
		).toMatchObject({ ok: true });
		expect(t.asked.map((input) => input.action)).toEqual([
			"fs.write.outside",
			"fs.write.outside",
		]);
		expect(await readFile(path, "utf8")).toBe("b");
	});

	it("keeps native write/edit adapters working inside the worktree", async () => {
		const t = await setup();
		const { ctx, registry } = toolContext("allow");
		const module = createToolsFsModule(ws);
		expect(await module.activate(ctx)).toMatchObject({ ok: true });
		const calls = [
			{ ref: "fs.write@1", input: { path: "note.txt", content: "a" } },
			{
				ref: "fs.edit@1",
				input: { path: "note.txt", oldStr: "a", newStr: "b" },
			},
			{ ref: "fs.write@1", input: { path: "note.txt", delete: true } },
		] as const;
		for (const { ref, input } of calls) {
			const adapter = registry.resolve<ToolAdapter<unknown, unknown>>(ref);
			if (!adapter.ok) throw new Error(`${ref} missing`);
			expect(
				await adapter.value[0].impl.run(input, { cwd: t.tree, signal }),
			).toMatchObject({ ok: true });
		}
		await expect(lstat(join(t.tree, "note.txt"))).rejects.toThrow();
		await expect(lstat(join(ws.workspaceDir, "note.txt"))).rejects.toThrow();
		ctx.disposables.dispose();
	});
});
