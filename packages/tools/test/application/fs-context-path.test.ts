import { link, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFsContext } from "../../src/infrastructure/fs-context.js";
import { tempWorkspace } from "../infrastructure/workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(async () => ws?.close());
const signal = new AbortController().signal;
const setup = async () => {
	ws = await tempWorkspace();
	const adapter = createFsContext({ workspaceDir: ws.workspaceDir });
	const inspect = (path: string) => adapter.inspect({ path }, signal);
	return { adapter, inspect };
};

describe("native editor context source paths", () => {
	it("normalizes absolute and traversed inputs to canonical relative paths", async () => {
		const { inspect } = await setup();
		const root = await ws.put("sample.ts", "source");
		const nested = await ws.put("src/sample.ts", "source");
		for (const path of [root, "./src/../sample.ts"])
			expect(await inspect(path)).toEqual({
				ok: true,
				value: { path: "sample.ts" },
			});
		expect(await inspect(nested)).toEqual({
			ok: true,
			value: { path: "src/sample.ts" },
		});
	});

	it.runIf(process.platform !== "win32")(
		"refuses source filenames that violate the canonical output contract",
		async () => {
			const { inspect } = await setup();
			for (const path of ["sample:notes.ts", "sample\\notes.ts"]) {
				await ws.put(path, "source");
				expect(await inspect(path)).toMatchObject({
					ok: false,
					error: { code: "bad_input" },
				});
			}
		},
	);

	it("returns the canonical workspace-relative path of an in-root alias", async () => {
		const { inspect } = await setup();
		await ws.put("src/main.ts", "const value = 1;");
		await symlink(
			join(ws.workspaceDir, "src"),
			join(ws.workspaceDir, "alias"),
			"junction",
		);
		expect(await inspect("alias/main.ts")).toEqual({
			ok: true,
			value: { path: "src/main.ts" },
		});
	});

	it("refuses another worktree and outside lexical aliases pointing back inside", async () => {
		const { inspect } = await setup();
		const root = join(ws.globalDir, "worktrees", "run", "task");
		const file = await ws.put("main.ts", "source", root);
		await ws.put("main.ts", "source");
		await symlink(ws.workspaceDir, join(ws.globalDir, "back"), "junction");
		for (const path of [
			file,
			join(ws.globalDir, "back", "main.ts"),
			"../global/back/main.ts",
		])
			expect(await inspect(path)).toMatchObject({
				ok: false,
				error: { code: "outside_workspace" },
			});
	});

	it("refuses directory links escaping the current workspace", async () => {
		const { inspect } = await setup();
		await ws.put("main.ts", "source", ws.globalDir);
		await symlink(ws.globalDir, join(ws.workspaceDir, "outside"), "junction");
		expect(await inspect("outside/main.ts")).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
	});

	it("refuses an outside parent alias even when its file link points back inside", async () => {
		const { inspect } = await setup();
		const target = await ws.put("main.ts", "source");
		await symlink(target, join(ws.globalDir, "back.ts"), "file");
		await symlink(ws.globalDir, join(ws.workspaceDir, "outside"), "junction");
		expect(await inspect("outside/back.ts")).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
	});

	it.each([".mete", ".git"])(
		"refuses lexical and canonical %s directories",
		async (folder) => {
			const { inspect } = await setup();
			await ws.put(`${folder}/state.ts`, "source");
			await symlink(
				join(ws.workspaceDir, folder),
				join(ws.workspaceDir, "alias"),
				"junction",
			);
			await symlink(
				ws.workspaceDir,
				join(ws.workspaceDir, folder, "back"),
				"junction",
			);
			await ws.put("main.ts", "source");
			for (const path of [
				`${folder}/state.ts`,
				"alias/state.ts",
				`${folder}/back/main.ts`,
			])
				expect(await inspect(path)).toMatchObject({
					ok: false,
					error: { code: "denied", rule: "protected_context_source" },
				});
		},
	);

	it("refuses the root ignore file and its file alias, but not a nested namesake", async () => {
		const { inspect } = await setup();
		const target = await ws.put(".meteignore", "# rules");
		await symlink(target, join(ws.workspaceDir, "rules.txt"), "file");
		await ws.put("src/.meteignore", "# ordinary source");
		for (const path of [".meteignore", "rules.txt"])
			expect(await inspect(path)).toMatchObject({
				ok: false,
				error: { code: "denied" },
			});
		expect(await inspect("src/.meteignore")).toMatchObject({ ok: true });
	});

	it.runIf(process.platform === "win32")(
		"refuses protected paths with Windows casing",
		async () => {
			const { inspect } = await setup();
			await ws.put(".mete/state.ts", "source");
			await ws.put(".git/config", "source");
			await ws.put(".meteignore", "# rules");
			for (const path of [".METE/state.ts", ".GIT/config", ".METEIGNORE"])
				expect(await inspect(path)).toMatchObject({
					ok: false,
					error: { code: "denied" },
				});
		},
	);

	it("checks ignore rules against the given alias as well as its canonical source", async () => {
		const { inspect } = await setup();
		await ws.put(".meteignore", "hidden/\n");
		await ws.put("src/main.ts", "source");
		await ws.put("hidden/main.ts", "source");
		await symlink(
			join(ws.workspaceDir, "hidden"),
			join(ws.workspaceDir, "alias"),
			"junction",
		);
		await symlink(
			join(ws.workspaceDir, "src"),
			join(ws.workspaceDir, "hidden", "back"),
			"junction",
		);
		for (const path of ["alias/main.ts", "hidden/back/main.ts"])
			expect(await inspect(path)).toMatchObject({
				ok: false,
				error: { code: "ignored" },
			});
	});

	it("reloads ignore rules and keeps their default and negation semantics", async () => {
		const { inspect } = await setup();
		await ws.put(".env.example", "source");
		await ws.put("main.ts", "source");
		expect(await inspect(".env.example")).toMatchObject({
			ok: false,
			error: { code: "ignored" },
		});
		await ws.put(".meteignore", "!.env.example\n/main.ts\n");
		expect(await inspect(".env.example")).toMatchObject({ ok: true });
		expect(await inspect("main.ts")).toMatchObject({
			ok: false,
			error: { code: "ignored" },
		});
	});

	it("fails closed when the ignore rule file cannot be read as a file", async () => {
		const { inspect } = await setup();
		await ws.put("main.ts", "source");
		await mkdir(join(ws.workspaceDir, ".meteignore"));
		expect(await inspect("main.ts")).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
	});

	it("fails closed when the ignore rule file is a dangling link", async () => {
		const { inspect } = await setup();
		await ws.put("main.ts", "source");
		await symlink(
			join(ws.workspaceDir, "missing"),
			join(ws.workspaceDir, ".meteignore"),
			"file",
		);
		expect(await inspect("main.ts")).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
	});

	it("refuses multiply-linked sources even when both names are inside", async () => {
		const { inspect } = await setup();
		const target = await ws.put("main.ts", "source");
		await link(target, join(ws.workspaceDir, "copy.ts"));
		expect(await inspect("main.ts")).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
	});

	it("refuses missing sources, folders, dangling links and link loops", async () => {
		const { inspect } = await setup();
		await mkdir(join(ws.workspaceDir, "src"));
		const loop = join(ws.workspaceDir, "loop.ts");
		await symlink(loop, loop, "file");
		await symlink(
			join(ws.workspaceDir, "missing.ts"),
			join(ws.workspaceDir, "dangling.ts"),
			"file",
		);
		for (const path of ["missing.ts", "dangling.ts"])
			expect(await inspect(path)).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
		expect(await inspect("src")).toMatchObject({
			ok: false,
			error: { code: "is_directory" },
		});
		expect(await inspect("loop.ts")).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
	});

	it.runIf(process.platform === "win32")(
		"refuses NTFS stream names",
		async () => {
			const { inspect } = await setup();
			await ws.put("main.ts", "source");
			for (const path of ["main.ts:secret", ".meteignore::$DATA"])
				expect(await inspect(path)).toMatchObject({
					ok: false,
					error: { code: "bad_input" },
				});
		},
	);
});
