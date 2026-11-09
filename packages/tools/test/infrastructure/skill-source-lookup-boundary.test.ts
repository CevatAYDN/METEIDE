import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { SkillSourceAdapter } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSkillSourceModule } from "../../src/index.js";
import type { SkillRoots } from "../../src/infrastructure/skill-location.js";
import { toolContext } from "../helpers/context.js";
import { tempWorkspace } from "./workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return {
		...native,
		open: vi.fn(native.open),
		opendir: vi.fn(native.opendir),
	};
});
const native =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
let module: MeteModule | undefined;
let held: FileHandle | undefined;
let path: string;
const signal = () => new AbortController().signal;
beforeEach(async () => {
	ws = await tempWorkspace();
	path = await ws.put(".mete/skills/one/SKILL.md", "body");
});
afterEach(async () => {
	await module?.deactivate();
	if (held && held.fd >= 0) await held.close();
	held = undefined;
	vi.restoreAllMocks();
	vi.mocked(fs.open).mockReset().mockImplementation(native.open);
	vi.mocked(fs.opendir).mockReset().mockImplementation(native.opendir);
	await ws.close();
});
const setup = async (roots: SkillRoots = ws) => {
	const { ctx, registry } = toolContext("deny");
	module = createSkillSourceModule(roots);
	expect((await module.activate(ctx)).ok).toBe(true);
	const resolved = registry.resolve<SkillSourceAdapter>("skill.source@1");
	if (!resolved.ok) throw new Error("Expected source adapter");
	const adapter = resolved.value[0].impl;
	const listed = await adapter.list(signal());
	if (!listed.ok || !listed.value.sources[0])
		throw new Error("Expected source");
	const input = { sourceId: listed.value.sources[0].sourceId };
	const read = (request = signal()) => adapter.read(input, request);
	return { adapter, listed: listed.value, read };
};
const mutate = async (change: string) => {
	if (change === "ignore") return ws.put(".meteignore", ".mete/skills/one/\n");
	if (change === "delete") return fs.unlink(path);
	if (change === "hardlink") return fs.link(path, `${path}.copy`);
	if (change === "replace") {
		await fs.rename(path, `${path}.old`);
		return fs.writeFile(path, "replacement");
	}
	// Windows permits the directory rename once its still-open file is moved out.
	if (held && held.fd >= 0)
		await fs.rename(path, join(ws.globalDir, "held-SKILL.md"));
	const relative = change === "root" ? ".mete/skills" : ".mete/skills/one";
	const directory = join(ws.workspaceDir, relative);
	await fs.rename(directory, `${directory}-old`);
	return change === "root"
		? ws.put(".mete/skills/one/SKILL.md", "new root")
		: fs.symlink(`${directory}-old`, directory, "junction");
};
const afterRead = async (action: () => Promise<unknown>) => {
	held = await native.open(path, "r");
	const read = held.read.bind(held);
	const close = vi.spyOn(held, "close");
	vi.mocked(fs.open).mockResolvedValueOnce(held);
	vi.spyOn(held, "read").mockImplementationOnce(async (...args: unknown[]) => {
		if (!Buffer.isBuffer(args[0])) throw new Error("Expected buffer");
		const result = await read(args[0], 0, args[0].length, 0);
		await action();
		return result;
	});
	return close;
};

it.each(["root", "link", "hardlink"])(
	"rejects a %s change after listing",
	async (change) => {
		const { read } = await setup();
		await mutate(change);
		vi.clearAllMocks();
		expect(await read()).toMatchObject({ ok: false });
		expect(fs.open).not.toHaveBeenCalled();
		expect(fs.opendir).not.toHaveBeenCalled();
		if (change === "root") {
			expect(await read()).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
			expect(fs.opendir).toHaveBeenCalled();
		}
	},
);

it.each([
	["ignore", "ignored"],
	["root", "not_found"],
	["hardlink", "bad_input"],
	["replace", "stale"],
	["link", "bad_input"],
	["delete", "not_found"],
])(
	"rejects an after-read %s change on the map-hit path",
	async (change, code) => {
		const { read } = await setup();
		let changed = false;
		const close = await afterRead(async () => {
			await mutate(change);
			changed = true;
		});
		vi.mocked(fs.opendir).mockClear();
		const result = await read();
		expect(changed).toBe(true);
		expect(fs.open).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ ok: false, error: { code } });
		expect(JSON.stringify(result)).not.toContain("body");
		expect(JSON.stringify(result)).not.toContain("replacement");
		expect(JSON.stringify(result)).not.toContain("new root");
		expect(close).toHaveBeenCalledOnce();
		expect(held?.fd).toBe(-1);
		expect(fs.opendir).not.toHaveBeenCalled();
	},
);

it("rejects a new FD opened after lookup replacement", async () => {
	const { read } = await setup();
	vi.mocked(fs.open).mockImplementationOnce(async () => {
		await mutate("replace");
		held = await native.open(path, "r");
		return held;
	});
	expect(await read()).toMatchObject({
		ok: false,
		error: { code: "stale" },
	});
	expect(held?.fd).toBe(-1);
});

it.each(["request", "deactivate"])(
	"closes the FD on %s cancellation",
	async (mode) => {
		const { read } = await setup();
		const controller = new AbortController();
		const close = await afterRead(async () => {
			if (mode === "request") controller.abort();
			else await module?.deactivate();
		});
		expect(await read(controller.signal)).toEqual({
			ok: false,
			error: { code: "aborted" },
		});
		expect(close).toHaveBeenCalledOnce();
	},
);

it("keeps canonical alias deduplication and current workspace ignore rules", async () => {
	const alias = join(ws.globalDir, "alias");
	await fs.symlink(ws.workspaceDir, alias, "junction");
	const { listed, read } = await setup({
		workspaceDir: alias,
		globalDir: join(ws.workspaceDir, ".mete"),
	});
	expect(listed.sources).toHaveLength(1);
	expect(listed.sources[0]?.scope).toBe("workspace");
	expect(listed.diagnostics).toContainEqual({
		code: "bad_input",
		location: "path",
	});
	expect(await read()).toMatchObject({ ok: true, value: { text: "body" } });
	await ws.put(".meteignore", ".mete/skills/one/\n");
	expect(await read()).toMatchObject({ ok: false, error: { code: "ignored" } });
});

it("checks target snapshots independently but still reports full-list failures", async () => {
	const { adapter, read } = await setup();
	await fs.symlink(ws.workspaceDir, join(ws.globalDir, "skills"), "junction");
	vi.clearAllMocks();
	expect(await read()).toMatchObject({ ok: true, value: { text: "body" } });
	expect(fs.opendir).not.toHaveBeenCalled();
	expect(await adapter.list(signal())).toMatchObject({
		ok: false,
		error: { code: "unavailable", location: "root" },
	});
});

it("reconstructs the global scope and rejects its replaced root", async () => {
	await ws.put("skills/global/SKILL.md", "global body", ws.globalDir);
	const { adapter, listed } = await setup();
	const source = listed.sources.find(({ scope }) => scope === "global");
	if (!source) throw new Error("Expected global source");
	const input = { sourceId: source.sourceId };
	vi.clearAllMocks();
	expect(await adapter.read(input, signal())).toMatchObject({
		ok: true,
		value: { source: { scope: "global" }, text: "global body" },
	});
	expect(fs.opendir).not.toHaveBeenCalled();
	const root = join(ws.globalDir, "skills");
	await fs.rename(root, `${root}-old`);
	await ws.put("skills/global/SKILL.md", "replacement", ws.globalDir);
	expect(await adapter.read(input, signal())).toMatchObject({
		ok: false,
		error: { code: "not_found" },
	});
});
