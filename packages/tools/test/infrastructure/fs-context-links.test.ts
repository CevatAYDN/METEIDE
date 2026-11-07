import { mkdir, symlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_LINK_HOPS } from "../../src/defaults.js";
import { createFsContext } from "../../src/infrastructure/fs-context.js";
import { tempWorkspace } from "./workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(async () => ws?.close());
const setup = async () => {
	ws = await tempWorkspace();
	const adapter = createFsContext({ workspaceDir: ws.workspaceDir });
	const inspect = (path: string) =>
		adapter.inspect({ path }, new AbortController().signal);
	return { inspect, target: await ws.put("src/a.ts", "source") };
};

describe("editor context intermediate link boundaries", () => {
	it("refuses a file link that escapes and links back to a safe source", async () => {
		const { inspect, target } = await setup();
		const back = join(ws.globalDir, "back.ts");
		await symlink(target, back, "file");
		await symlink(back, join(ws.workspaceDir, "alias.ts"), "file");
		expect(await inspect("alias.ts")).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
	});

	it("refuses an intermediate directory link that escapes and returns", async () => {
		const { inspect } = await setup();
		const back = join(ws.globalDir, "back");
		await symlink(join(ws.workspaceDir, "src"), back, "junction");
		await symlink(back, join(ws.workspaceDir, "alias"), "junction");
		expect(await inspect("alias/a.ts")).toMatchObject({
			ok: false,
			error: { code: "outside_workspace" },
		});
	});

	it.each([".mete/state.ts", ".git/config", ".meteignore"])(
		"refuses a protected intermediate file link: %s",
		async (path) => {
			const { inspect, target } = await setup();
			await mkdir(join(ws.workspaceDir, ".mete"), { recursive: true });
			await mkdir(join(ws.workspaceDir, ".git"), { recursive: true });
			const intermediate = join(ws.workspaceDir, path);
			await symlink(target, intermediate, "file");
			await symlink(intermediate, join(ws.workspaceDir, "alias.ts"), "file");
			expect(await inspect("alias.ts")).toMatchObject({
				ok: false,
				error: { code: "denied", rule: "protected_context_source" },
			});
		},
	);

	it.each([".mete", ".git", "hidden"])(
		"refuses an intermediate directory alias under %s",
		async (folder) => {
			const { inspect } = await setup();
			await ws.put(".meteignore", "hidden/\n");
			await mkdir(join(ws.workspaceDir, folder), { recursive: true });
			const intermediate = join(ws.workspaceDir, folder, "back");
			await symlink(join(ws.workspaceDir, "src"), intermediate, "junction");
			await symlink(intermediate, join(ws.workspaceDir, "alias"), "junction");
			expect(await inspect("alias/a.ts")).toMatchObject({
				ok: false,
				error: { code: folder === "hidden" ? "ignored" : "denied" },
			});
		},
	);

	it("refuses an ignored intermediate file with an otherwise allowed final target", async () => {
		const { inspect, target } = await setup();
		await ws.put(".meteignore", "/hidden.ts\n");
		const hidden = join(ws.workspaceDir, "hidden.ts");
		await symlink(target, hidden, "file");
		await symlink(hidden, join(ws.workspaceDir, "alias.ts"), "file");
		expect(await inspect("alias.ts")).toMatchObject({
			ok: false,
			error: { code: "ignored" },
		});
	});

	it("does not erase forbidden ancestors from the supplied path", async () => {
		const { inspect } = await setup();
		await ws.put(".meteignore", "hidden/\n");
		await symlink(ws.globalDir, join(ws.workspaceDir, "escape"), "junction");
		for (const [folder, code] of [
			["escape", "outside_workspace"],
			[".mete", "denied"],
			["hidden", "ignored"],
		]) {
			expect(await inspect(`${folder}/../src/a.ts`)).toMatchObject({
				ok: false,
				error: { code },
			});
		}
	});

	it("preserves safe relative file chains and directory aliases within the root", async () => {
		const { inspect, target } = await setup();
		const first = join(ws.workspaceDir, "src", "first.ts");
		await symlink(
			relative(join(ws.workspaceDir, "src"), target),
			first,
			"file",
		);
		await symlink(
			relative(ws.workspaceDir, first),
			join(ws.workspaceDir, "alias.ts"),
			"file",
		);
		await symlink(
			join(ws.workspaceDir, "src"),
			join(ws.workspaceDir, "alias-dir"),
			"junction",
		);
		for (const path of ["alias.ts", "alias-dir/first.ts"])
			expect(await inspect(path)).toEqual({
				ok: true,
				value: { path: "src/a.ts" },
			});
	});

	it("fails closed on a multi-link cycle", async () => {
		const { inspect } = await setup();
		const first = join(ws.workspaceDir, "first.ts");
		const second = join(ws.workspaceDir, "second.ts");
		await symlink(second, first, "file");
		await symlink(first, second, "file");
		expect(await inspect("first.ts")).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
	});

	it("allows the bounded safe chain and refuses one additional link", async () => {
		const { inspect, target } = await setup();
		let previous = target;
		for (let hop = 0; hop < CONTEXT_LINK_HOPS; hop++) {
			const path = join(ws.workspaceDir, `link-${hop}.ts`);
			await symlink(previous, path, "file");
			previous = path;
		}
		expect(await inspect(previous)).toEqual({
			ok: true,
			value: { path: "src/a.ts" },
		});
		const extra = join(ws.workspaceDir, "extra.ts");
		await symlink(previous, extra, "file");
		expect(await inspect(extra)).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
	});

	it.runIf(process.platform !== "win32")(
		"does not normalize forbidden link-target ancestors away before checking them",
		async () => {
			const { inspect } = await setup();
			await ws.put(".meteignore", "hidden/\n");
			for (const folder of [".mete", ".git", "hidden"]) {
				await mkdir(join(ws.workspaceDir, folder), { recursive: true });
				const alias = `${folder.slice(1)}-alias.ts`;
				await symlink(
					`${folder}/../src/a.ts`,
					join(ws.workspaceDir, alias),
					"file",
				);
				expect(await inspect(alias)).toMatchObject({
					ok: false,
					error: { code: folder === "hidden" ? "ignored" : "denied" },
				});
			}
		},
	);
});
