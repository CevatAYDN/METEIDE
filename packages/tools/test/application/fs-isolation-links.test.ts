import { link, lstat, mkdir, readFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	ok,
	type PolicyCheckInput,
	type ToolIsolationInput,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type FsDeps, scoped } from "../../src/application/fs-common.js";
import { createFsIsolation } from "../../src/application/fs-isolation.js";
import { editTool, writeTool } from "../../src/application/fs-write.js";
import { tempWorkspace } from "../infrastructure/workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(async () => {
	await ws?.close();
});
const signal = new AbortController().signal;
const setup = async () => {
	ws = await tempWorkspace();
	const worktreesDir = join(ws.globalDir, "worktrees");
	const tree = join(worktreesDir, "run", "a");
	const sibling = join(worktreesDir, "run", "b");
	await mkdir(tree, { recursive: true });
	await mkdir(sibling, { recursive: true });
	const asked: PolicyCheckInput[] = [];
	const deps: FsDeps = {
		adapterId: "tools-fs",
		workspaceDir: ws.workspaceDir,
		worktreesDir,
		policy: () => ({
			check: (input) => {
				asked.push(input);
				return ok({ verdict: "allow", rule: "test" });
			},
		}),
	};
	const scope = await scoped(deps, { cwd: tree, signal });
	if (!scope.ok) throw new Error(scope.error.message);
	const inspect = (
		capability: ToolIsolationInput["capability"],
		input: unknown,
	) =>
		createFsIsolation(deps).inspect(
			{ capability, adapterId: deps.adapterId, input, cwd: tree },
			signal,
		);
	return { tree, sibling, deps, scoped: scope.value, asked, inspect };
};

describe("native file isolation across links", () => {
	it.each([
		["write", "sibling"],
		["edit", "sibling"],
		["write", "workspace"],
		["edit", "workspace"],
	] as const)(
		"refuses %s to a hard link shared with %s",
		async (operation, owner) => {
			const t = await setup();
			const root = owner === "sibling" ? t.sibling : ws.workspaceDir;
			const outside = await ws.put("shared.txt", "keep", root);
			const inside = join(t.tree, "shared.txt");
			await link(outside, inside);
			expect((await stat(inside)).nlink).toBeGreaterThan(1);
			const input =
				operation === "write"
					? { path: "shared.txt", content: "bad" }
					: { path: "shared.txt", oldStr: "keep", newStr: "bad" };
			const capability = operation === "write" ? "fs.write@1" : "fs.edit@1";
			expect(await t.inspect(capability, input)).toEqual({
				ok: true,
				value: { scope: "workspace" },
			});
			const tool = operation === "write" ? writeTool : editTool;
			expect(await tool(t.scoped, input, { signal })).toMatchObject({
				ok: false,
				error: { code: "outside_workspace" },
			});
			expect(await readFile(outside, "utf8")).toBe("keep");
			expect(await readFile(inside, "utf8")).toBe("keep");
			expect(t.asked).toEqual([]);
		},
	);

	it("rechecks a target linked after isolation inspection", async () => {
		const t = await setup();
		const inside = await ws.put("shared.txt", "keep", t.tree);
		const input = { path: "shared.txt", content: "bad" };
		expect(await t.inspect("fs.write@1", input)).toMatchObject({
			ok: true,
			value: { scope: "worktree" },
		});
		const outside = join(t.sibling, "shared.txt");
		await link(inside, outside);
		expect(await writeTool(t.scoped, input, { signal })).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
		expect(await readFile(outside, "utf8")).toBe("keep");
		expect(t.asked).toEqual([]);
	});

	it("refuses deleting a sibling file link pointing into the scoped tree", async () => {
		const t = await setup();
		const inside = await ws.put("target.txt", "keep", t.tree);
		const outside = join(t.sibling, "reverse.txt");
		await symlink(inside, outside, "file");
		const input = { path: outside, delete: true };
		expect(await t.inspect("fs.write@1", input)).toEqual({
			ok: true,
			value: { scope: "workspace" },
		});
		expect(await writeTool(t.scoped, input, { signal })).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
		expect((await lstat(outside)).isSymbolicLink()).toBe(true);
		expect(await readFile(inside, "utf8")).toBe("keep");
		expect(t.asked).toEqual([]);
	});

	it("refuses changes to an outside entry hidden behind a parent alias", async () => {
		const t = await setup();
		const inside = await ws.put("target.txt", "keep", t.tree);
		const outside = join(t.sibling, "reverse.txt");
		await symlink(inside, outside, "file");
		await symlink(t.sibling, join(t.tree, "alias"), "junction");
		const path = join("alias", "reverse.txt");
		for (const input of [
			{ path, delete: true },
			{ path, content: "bad" },
		]) {
			expect(await t.inspect("fs.write@1", input)).toEqual({
				ok: true,
				value: { scope: "workspace" },
			});
			expect(await writeTool(t.scoped, input, { signal })).toMatchObject({
				ok: false,
				error: { code: "outside_workspace" },
			});
		}
		const edit = { path, oldStr: "keep", newStr: "bad" };
		expect(await t.inspect("fs.edit@1", edit)).toEqual({
			ok: true,
			value: { scope: "workspace" },
		});
		expect(await editTool(t.scoped, edit, { signal })).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
		expect((await lstat(outside)).isSymbolicLink()).toBe(true);
		expect(await readFile(inside, "utf8")).toBe("keep");
		expect(t.asked).toEqual([]);
	});

	it("still deletes an in-tree file link without deleting its target", async () => {
		const t = await setup();
		const inside = await ws.put("target.txt", "keep", t.tree);
		const path = join(t.tree, "link.txt");
		await symlink(inside, path, "file");
		const input = { path, delete: true };
		expect(await t.inspect("fs.write@1", input)).toMatchObject({
			ok: true,
			value: { scope: "worktree" },
		});
		expect(await writeTool(t.scoped, input, { signal })).toMatchObject({
			ok: true,
			value: { bytes: 0 },
		});
		await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(inside, "utf8")).toBe("keep");
	});

	it("preserves ordinary outside-write policy for a multiply-linked target", async () => {
		const t = await setup();
		const path = await ws.put("outside.txt", "keep", ws.globalDir);
		const inside = join(t.tree, "shared.txt");
		await link(path, inside);
		expect(
			await writeTool(t.deps, { path, content: "a" }, { signal }),
		).toMatchObject({ ok: true });
		expect(
			await editTool(t.deps, { path, oldStr: "a", newStr: "b" }, { signal }),
		).toMatchObject({ ok: true });
		expect(await readFile(inside, "utf8")).toBe("b");
		expect(t.asked.map((input) => input.action)).toEqual([
			"fs.write.outside",
			"fs.write.outside",
		]);
	});

	it("fails closed when stat finds a non-directory parent", async () => {
		const t = await setup();
		await ws.put("file.txt", "keep", t.tree);
		const input = { path: join("file.txt", "child.txt"), content: "bad" };
		expect(await t.inspect("fs.write@1", input)).toEqual({
			ok: true,
			value: { scope: "workspace" },
		});
		expect(await writeTool(t.scoped, input, { signal })).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		expect(t.asked).toEqual([]);
	});

	it("fails closed when stat cannot resolve a file link loop", async () => {
		const t = await setup();
		const path = join(t.tree, "loop.txt");
		await symlink(path, path, "file");
		const input = { path, content: "bad" };
		expect(await t.inspect("fs.write@1", input)).toEqual({
			ok: true,
			value: { scope: "workspace" },
		});
		expect(await writeTool(t.scoped, input, { signal })).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
		expect(t.asked).toEqual([]);
	});
});
