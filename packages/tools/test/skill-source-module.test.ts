import * as fs from "node:fs/promises";
import {
	type SkillSourceAdapter,
	SkillSourceListSchema,
	SkillSourceSnapshotSchema,
	TOOL_CATALOG,
	type ToolAdapter,
} from "@mete/contracts";
import type { Disposable, DisposableStore } from "@mete/kernel";
import { afterEach, expect, it, vi } from "vitest";
import { createSkillSourceModule, createToolsFsModule } from "../src/index.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return {
		...native,
		realpath: vi.fn(native.realpath),
		lstat: vi.fn(native.lstat),
		opendir: vi.fn(native.opendir),
		open: vi.fn(native.open),
	};
});
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
let disposables: DisposableStore;
afterEach(async () => {
	disposables?.dispose();
	vi.clearAllMocks();
	await ws?.close();
});
const setup = async () => {
	ws = await tempWorkspace();
	const entries: Disposable[] = [];
	disposables = {
		add: (entry) => {
			entries.push(entry);
		},
		dispose: () => {
			for (const entry of entries.splice(0)) entry.dispose();
		},
	};
	const context = toolContext("deny");
	return { ...context, ctx: { ...context.ctx, disposables } };
};

it("registers without scanning and attests the exact object", async () => {
	const { ctx, registry } = await setup();
	const native = new WeakSet<SkillSourceAdapter>();
	const onAdapter = vi.fn((adapter: SkillSourceAdapter) => native.add(adapter));
	const module = createSkillSourceModule({ ...ws, onAdapter });
	vi.clearAllMocks();
	expect(await module.activate(ctx)).toEqual({ ok: true, value: undefined });
	for (const operation of [fs.realpath, fs.lstat, fs.opendir, fs.open])
		expect(operation).not.toHaveBeenCalled();
	expect(module.manifest).toMatchObject({
		class: "optional",
		provides: ["skill.source@1"],
		requires: [],
		permissions: ["fs.read"],
		activation: ["onStartup"],
	});
	const resolved = registry.resolve<SkillSourceAdapter>("skill.source@1");
	if (!resolved.ok) throw new Error("Expected source adapter");
	const impl = resolved.value[0].impl;
	expect(onAdapter).toHaveBeenCalledOnce();
	expect(onAdapter).toHaveBeenCalledWith(impl);
	expect(native.has(impl)).toBe(true);
	expect(native.has({ list: impl.list, read: impl.read })).toBe(false);
	expect(impl).not.toHaveProperty("run");
	expect(TOOL_CATALOG.some(({ ref }) => ref === "skill.source@1")).toBe(false);
	await module.deactivate();
	disposables.dispose();
	expect(registry.has("skill.source@1")).toBe(false);
});

const activated = async () => {
	const { ctx, registry } = await setup();
	const sourceModule = createSkillSourceModule(ws);
	expect((await sourceModule.activate(ctx)).ok).toBe(true);
	expect((await createToolsFsModule(ws).activate(ctx)).ok).toBe(true);
	const source = registry.resolve<SkillSourceAdapter>("skill.source@1");
	const files = registry.resolve<ToolAdapter<unknown, unknown>>("fs.read@1");
	if (!source.ok || !files.ok) throw new Error("Expected both adapters");
	return { source: source.value[0].impl, files: files.value[0].impl };
};

it("serves snapshots without broadening normal file reads", async () => {
	const { source, files } = await activated();
	const signal = new AbortController().signal;
	const absent = await source.list(signal);
	expect(absent).toEqual({
		ok: true,
		value: { sources: [], complete: true, diagnostics: [] },
	});
	const path = await ws.put(
		"skills/one/SKILL.md",
		"\ufeffbody\r\n",
		ws.globalDir,
	);
	const listed = await source.list(signal);
	if (!listed.ok) throw new Error("Expected inventory");
	const inventory = SkillSourceListSchema.parse(listed.value);
	const descriptor = inventory.sources[0];
	if (!descriptor) throw new Error("Expected descriptor");
	const read = await source.read({ sourceId: descriptor.sourceId }, signal);
	if (!read.ok) throw new Error("Expected snapshot");
	expect(SkillSourceSnapshotSchema.parse(read.value)).toMatchObject({
		source: descriptor,
		text: "\ufeffbody\r\n",
	});
	expect(await files.run({ path }, { signal })).toMatchObject({
		ok: false,
		error: { code: "outside_workspace" },
	});
	const forged = { sourceId: descriptor.sourceId, root: ws.globalDir };
	expect(await source.read(forged, signal)).toEqual({
		ok: false,
		error: { code: "bad_input" },
	});
	await ws.put("skills/one/SKILL.md", "changed", ws.globalDir);
	expect(
		await source.read({ sourceId: descriptor.sourceId }, signal),
	).toMatchObject({ ok: true, value: { text: "changed" } });
});
