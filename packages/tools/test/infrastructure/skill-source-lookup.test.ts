import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SKILL_ROOT_ENTRIES } from "../../src/defaults.js";
import { readSkillSource } from "../../src/infrastructure/skill-reader.js";
import { createSkillSourceLookup } from "../../src/infrastructure/skill-source-lookup.js";
import { tempWorkspace } from "./workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return {
		...native,
		lstat: vi.fn(native.lstat),
		opendir: vi.fn(native.opendir),
	};
});
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
const signal = () => new AbortController().signal;
beforeEach(async () => {
	ws = await tempWorkspace();
});
afterEach(async () => {
	vi.clearAllMocks();
	await ws.close();
});
const setup = async () => {
	await ws.put(".mete/skills/one/SKILL.md", "old");
	const lookup = createSkillSourceLookup(ws);
	const listed = await lookup.list(signal());
	if (!listed.ok || !listed.value.sources[0])
		throw new Error("Expected source");
	const source = listed.value.sources[0];
	const input = { sourceId: source.sourceId };
	const read = () =>
		readSkillSource({ ...ws, locate: lookup.locate }, input, signal());
	return { lookup, source, input, read };
};

it("reads 128 native sources with bounded linear metadata and no root rescans", async () => {
	for (let i = 0; i < 128; i++)
		await ws.put(`.mete/skills/skill-${i}/SKILL.md`, "abc");
	const lookup = createSkillSourceLookup(ws);
	const listed = await lookup.list(signal());
	if (!listed.ok) throw new Error("Expected complete inventory");
	expect(listed.value.complete).toBe(true);
	expect(listed.value.sources).toHaveLength(128);
	vi.clearAllMocks();
	for (const { sourceId } of listed.value.sources) {
		const read = await readSkillSource(
			{ ...ws, locate: lookup.locate },
			{ sourceId },
			signal(),
		);
		expect(read).toMatchObject({ ok: true, value: { text: "abc" } });
	}
	expect(fs.opendir).not.toHaveBeenCalled();
	expect(vi.mocked(fs.lstat).mock.calls.length).toBeGreaterThan(128);
	expect(vi.mocked(fs.lstat).mock.calls.length).toBeLessThanOrEqual(128 * 32);
});

it("copies lookup hints and returns fresh raw bytes and digest after listing", async () => {
	const { source, read } = await setup();
	source.path = "other/SKILL.md";
	source.scope = "global";
	await ws.put(".mete/skills/one/SKILL.md", "abc");
	expect(await read()).toMatchObject({
		ok: true,
		value: {
			source: { scope: "workspace", path: "one/SKILL.md" },
			text: "abc",
			sha256:
				"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		},
	});
});

it("reloads ignore rules on a hint hit", async () => {
	const { read } = await setup();
	await ws.put(".meteignore", ".mete/skills/one/\n");
	vi.clearAllMocks();
	expect(await read()).toMatchObject({
		ok: false,
		error: { code: "ignored" },
	});
	expect(fs.opendir).not.toHaveBeenCalled();
});

it("uses full current enumeration for unknown IDs without caller paths", async () => {
	const { lookup, input } = await setup();
	lookup.clear();
	vi.clearAllMocks();
	expect(await lookup.locate(input, signal())).toMatchObject({ ok: true });
	expect(fs.opendir).toHaveBeenCalled();
	vi.clearAllMocks();
	expect(
		await lookup.locate({ ...input, root: ws.globalDir }, signal()),
	).toEqual({ ok: false, error: { code: "bad_input" } });
	expect(fs.opendir).not.toHaveBeenCalled();
});

it.each(["empty", "incomplete"])(
	"replaces hints after a %s list",
	async (mode) => {
		const { lookup, input } = await setup();
		const child = join(ws.workspaceDir, ".mete/skills/one");
		const moved = join(ws.globalDir, "one");
		if (mode === "empty") await fs.rename(child, moved);
		else {
			for (let i = 0; i < SKILL_ROOT_ENTRIES; i++)
				await fs.mkdir(join(ws.workspaceDir, `.mete/skills/empty-${i}`));
		}
		const listed = await lookup.list(signal());
		expect(listed).toMatchObject({
			ok: true,
			value: { complete: mode === "empty" },
		});
		if (mode === "empty") await fs.rename(moved, child);
		vi.clearAllMocks();
		const located = await lookup.locate(input, signal());
		expect(located).toMatchObject(
			mode === "empty"
				? { ok: true }
				: { ok: false, error: { code: "limit_exceeded" } },
		);
		expect(fs.opendir).toHaveBeenCalled();
	},
);
