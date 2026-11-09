import * as fs from "node:fs/promises";
import type { SkillSourceAdapter } from "@mete/contracts";
import type { Disposable, MeteModule } from "@mete/kernel";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSkillSourceModule } from "../src/index.js";
import { createSkillSourceLookup } from "../src/infrastructure/skill-source-lookup.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return { ...native, opendir: vi.fn(native.opendir) };
});
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
let module: MeteModule | undefined;
let owned: Disposable[] = [];
const signal = () => new AbortController().signal;
beforeEach(async () => {
	ws = await tempWorkspace();
	await ws.put(".mete/skills/one/SKILL.md", "body");
});
afterEach(async () => {
	await module?.deactivate();
	for (const entry of owned) entry.dispose();
	owned = [];
	vi.clearAllMocks();
	await ws.close();
});
const setup = async () => {
	const { ctx, registry } = toolContext("deny");
	const context = {
		...ctx,
		disposables: {
			add: (entry: Disposable) => owned.push(entry),
			dispose: () => {
				for (const entry of owned) entry.dispose();
			},
		},
	};
	module = createSkillSourceModule(ws);
	expect((await module.activate(context)).ok).toBe(true);
	const source = registry.resolve<SkillSourceAdapter>("skill.source@1");
	if (!source.ok) throw new Error("Expected source adapter");
	return { module, context, registry, adapter: source.value[0].impl };
};
const inputOf = async (adapter: SkillSourceAdapter) => {
	const listed = await adapter.list(signal());
	if (!listed.ok || !listed.value.sources[0])
		throw new Error("Expected source");
	return { sourceId: listed.value.sources[0].sourceId };
};
const deferred = () => {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const holdDirectory = async () => {
	const native =
		await vi.importActual<typeof import("node:fs/promises")>(
			"node:fs/promises",
		);
	const entered = deferred();
	const release = deferred();
	vi.mocked(fs.opendir).mockImplementationOnce(async (...args) => {
		const directory = await native.opendir(...args);
		entered.resolve();
		await release.promise;
		return directory;
	});
	return { entered, release };
};

it("uses the activation lookup for both reader validation points", async () => {
	const { adapter } = await setup();
	const input = await inputOf(adapter);
	vi.clearAllMocks();
	expect(await adapter.read(input, signal())).toMatchObject({
		ok: true,
		value: { text: "body" },
	});
	expect(fs.opendir).not.toHaveBeenCalled();
	expect((await adapter.list(signal())).ok).toBe(true);
	expect(fs.opendir).toHaveBeenCalled();
});

it.each(["deactivate", "disposables"])(
	"retires the adapter through %s",
	async (mode) => {
		const { module, adapter, context, registry } = await setup();
		const input = await inputOf(adapter);
		if (mode === "deactivate") await module.deactivate();
		else context.disposables.dispose();
		expect(registry.has("skill.source@1")).toBe(false);
		vi.clearAllMocks();
		expect(await adapter.list(signal())).toEqual({
			ok: false,
			error: { code: "aborted" },
		});
		expect(await adapter.read(input, signal())).toEqual({
			ok: false,
			error: { code: "aborted" },
		});
		expect(fs.opendir).not.toHaveBeenCalled();
	},
);

it("does not repopulate cleared hints from a late native list", async () => {
	const lookup = createSkillSourceLookup(ws);
	const gate = await holdDirectory();
	const pending = lookup.list(signal());
	await gate.entered.promise;
	lookup.clear();
	gate.release.resolve();
	const listed = await pending;
	if (!listed.ok || !listed.value.sources[0])
		throw new Error("Expected source");
	vi.clearAllMocks();
	expect(
		await lookup.locate(
			{ sourceId: listed.value.sources[0].sourceId },
			signal(),
		),
	).toMatchObject({ ok: true });
	expect(fs.opendir).toHaveBeenCalled();
});

it("aborts a late list and isolates replacement activation and old disposal", async () => {
	const { module, adapter, context, registry } = await setup();
	const input = await inputOf(adapter);
	const gate = await holdDirectory();
	const pending = adapter.list(signal());
	await gate.entered.promise;
	await module.deactivate();
	expect((await module.activate(context)).ok).toBe(true);
	gate.release.resolve();
	expect(await pending).toEqual({ ok: false, error: { code: "aborted" } });
	owned[0]?.dispose();
	const replacement = registry.resolve<SkillSourceAdapter>("skill.source@1");
	if (!replacement.ok) throw new Error("Expected replacement adapter");
	expect(replacement.value[0].impl).not.toBe(adapter);
	vi.clearAllMocks();
	expect(await replacement.value[0].impl.read(input, signal())).toMatchObject({
		ok: true,
		value: { text: "body" },
	});
	expect(fs.opendir).toHaveBeenCalled();
	expect(await adapter.read(input, signal())).toEqual({
		ok: false,
		error: { code: "aborted" },
	});
});
