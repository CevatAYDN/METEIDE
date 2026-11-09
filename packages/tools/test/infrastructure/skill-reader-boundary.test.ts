import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { SKILL_LIMITS, type SkillSourceAdapter } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { afterEach, expect, it, vi } from "vitest";
import { listSkillSources } from "../../src/infrastructure/skill-enumeration.js";
import { readSkillSource } from "../../src/infrastructure/skill-reader.js";
import { createSkillSourceModule } from "../../src/skill-source-module.js";
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
let held: FileHandle | undefined;
let module: MeteModule | undefined;
afterEach(async () => {
	await module?.deactivate();
	module = undefined;
	if (held && held.fd >= 0) await held.close();
	held = undefined;
	vi.restoreAllMocks();
	vi.mocked(fs.open).mockReset().mockImplementation(native.open);
	vi.mocked(fs.opendir).mockReset().mockImplementation(native.opendir);
	await ws?.close();
});
const setup = async (cached = false) => {
	ws = await tempWorkspace();
	const path = await ws.put(".mete/skills/one/SKILL.md", "private body");
	let adapter: SkillSourceAdapter | undefined;
	if (cached) {
		const { ctx, registry } = toolContext("deny");
		module = createSkillSourceModule(ws);
		expect((await module.activate(ctx)).ok).toBe(true);
		const source = registry.resolve<SkillSourceAdapter>("skill.source@1");
		if (!source.ok) throw new Error("Expected the native source adapter");
		adapter = source.value[0].impl;
	}
	const signal = new AbortController().signal;
	const inventory = adapter
		? await adapter.list(signal)
		: await listSkillSources(ws, signal);
	if (!inventory.ok || !inventory.value.sources[0])
		throw new Error("Expected inventory");
	const input = { sourceId: inventory.value.sources[0].sourceId };
	const read = (signal = new AbortController().signal) =>
		adapter ? adapter.read(input, signal) : readSkillSource(ws, input, signal);
	const open = async () => {
		held = await native.open(path, "r");
		vi.mocked(fs.open).mockResolvedValueOnce(held);
		return { handle: held, close: vi.spyOn(held, "close") };
	};
	return { path, input, read, open };
};
const afterRead = (handle: FileHandle, action: () => Promise<unknown>) => {
	const read = handle.read.bind(handle);
	vi.spyOn(handle, "read").mockImplementationOnce(
		async (...args: unknown[]) => {
			if (!Buffer.isBuffer(args[0])) throw new Error("Expected a buffer");
			const result = await read(args[0], 0, args[0].length, 0);
			await action();
			return result;
		},
	);
};

it("returns safe read failures and closes the descriptor", async () => {
	const { read, open } = await setup();
	const { handle, close } = await open();
	vi.spyOn(handle, "read").mockRejectedValueOnce(new Error("private OS error"));
	expect(await read()).toEqual({
		ok: false,
		error: { code: "unavailable", location: "source" },
	});
	expect(close).toHaveBeenCalledOnce();
});

it("refuses replacement between current lookup and native open", async () => {
	const { path, read } = await setup();
	vi.mocked(fs.open).mockImplementationOnce(async () => {
		await fs.rename(path, `${path}.old`);
		await fs.writeFile(path, "replacement");
		held = await native.open(path, "r");
		return held;
	});
	expect(await read()).toEqual({
		ok: false,
		error: { code: "stale", location: "source" },
	});
	expect(held?.fd).toBe(-1);
});

it("refuses nonregular descriptor metadata without reading it", async () => {
	const { read, open } = await setup();
	const { handle, close } = await open();
	const metadata = await handle.stat({ bigint: true });
	vi.spyOn(handle, "stat").mockResolvedValueOnce(
		Object.assign(metadata, { isFile: () => false }),
	);
	const reads = vi.spyOn(handle, "read");
	expect(await read()).toEqual({
		ok: false,
		error: { code: "bad_input", location: "source" },
	});
	expect(reads).not.toHaveBeenCalled();
	expect(close).toHaveBeenCalledOnce();
});

it("refuses a changed held identity even when the current path still exists", async () => {
	const { read, open } = await setup();
	const { handle, close } = await open();
	const initial = await handle.stat({ bigint: true });
	const changed = await handle.stat({ bigint: true });
	vi.spyOn(handle, "stat")
		.mockResolvedValueOnce(initial)
		.mockResolvedValueOnce(Object.assign(changed, { ino: changed.ino + 1n }));
	expect(await read()).toEqual({
		ok: false,
		error: { code: "stale", location: "source" },
	});
	expect(close).toHaveBeenCalledOnce();
});

it("caps a file that grows after initial descriptor stat", async () => {
	const { path, read, open } = await setup();
	const { handle, close } = await open();
	afterRead(handle, () =>
		fs.appendFile(path, Buffer.alloc(SKILL_LIMITS.fileBytes, 0x61)),
	);
	expect(await read()).toEqual({
		ok: false,
		error: { code: "limit_exceeded", location: "source" },
	});
	expect(close).toHaveBeenCalledOnce();
});

const replaceDirectory = async (path: string, change: string) => {
	// Move the still-open file out first so Windows permits the directory rename.
	await fs.rename(path, join(ws.globalDir, "held-SKILL.md"));
	const directory = join(
		ws.workspaceDir,
		".mete",
		"skills",
		change === "child junction" ? "one" : "",
	);
	await fs.rename(directory, `${directory}-old`);
	if (change !== "root")
		await fs.symlink(`${directory}-old`, directory, "junction");
	await ws.put(".mete/skills/one/SKILL.md", "replacement");
};
const checkAfterReadChange = async (change: string, cached = false) => {
	const { path, read, open } = await setup(cached);
	const { handle, close } = await open();
	let changed = false;
	afterRead(handle, async () => {
		if (change === "ignore") await ws.put(".meteignore", ".mete/skills/one/\n");
		else await replaceDirectory(path, change);
		changed = true;
	});
	vi.mocked(fs.opendir).mockClear();
	const result = await read();
	expect(changed).toBe(true);
	expect(fs.open).toHaveBeenCalledOnce();
	expect(result).toMatchObject({
		ok: false,
		error: {
			code:
				change === "ignore"
					? "ignored"
					: change === "root"
						? "not_found"
						: change === "root junction"
							? "unavailable"
							: "bad_input",
		},
	});
	expect(JSON.stringify(result)).not.toContain("private body");
	expect(JSON.stringify(result)).not.toContain("replacement");
	expect(close).toHaveBeenCalledOnce();
	expect(handle.fd).toBe(-1);
	if (cached) expect(fs.opendir).not.toHaveBeenCalled();
};

it.each(["ignore", "root", "root junction", "child junction"])(
	"rechecks an after-read %s change",
	(change) => checkAfterReadChange(change),
);
it.each(["root", "root junction", "child junction"])(
	"rechecks an after-read %s change through the native cached source module",
	(change) => checkAfterReadChange(change, true),
);

it("propagates cancellation during current-inventory revalidation", async () => {
	const { read, open } = await setup();
	const { handle, close } = await open();
	const controller = new AbortController();
	afterRead(handle, async () => {
		vi.mocked(fs.opendir).mockImplementationOnce(async () => {
			controller.abort();
			throw new Error("cancelled");
		});
	});
	expect(await read(controller.signal)).toEqual({
		ok: false,
		error: { code: "aborted" },
	});
	expect(close).toHaveBeenCalledOnce();
});

it("does not open a file for forged input or pre-cancellation", async () => {
	const { input } = await setup();
	const controller = new AbortController();
	controller.abort();
	expect(await readSkillSource(ws, input, controller.signal)).toEqual({
		ok: false,
		error: { code: "aborted" },
	});
	expect(
		await readSkillSource(
			ws,
			{ ...input, path: ws.globalDir },
			new AbortController().signal,
		),
	).toEqual({ ok: false, error: { code: "bad_input" } });
	expect(fs.open).not.toHaveBeenCalled();
});
