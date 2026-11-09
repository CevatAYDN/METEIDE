import { Dir } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SKILL_ROOT_ENTRIES } from "../../src/defaults.js";
import {
	listSkillSources,
	resolveSkillLocation,
} from "../../src/infrastructure/skill-enumeration.js";
import { tempWorkspace } from "./workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return { ...native, opendir: vi.fn(native.opendir) };
});
const native =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
const signal = () => new AbortController().signal;
const list = () => listSkillSources(ws, signal());
const put = () => ws.put(".mete/skills/one/SKILL.md", "body");
beforeEach(async () => {
	ws = await tempWorkspace();
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.mocked(fs.opendir).mockReset().mockImplementation(native.opendir);
	await ws.close();
});

it("keeps missing roots empty without creating directories", async () => {
	expect(await list()).toEqual({
		ok: true,
		value: { sources: [], complete: true, diagnostics: [] },
	});
	await expect(fs.stat(join(ws.globalDir, "skills"))).rejects.toThrow();
});

it("reads exact direct-child sources in both scopes", async () => {
	await put();
	await ws.put("skills/one/SKILL.md", "global", ws.globalDir);
	await ws.put(".mete/skills/deeper/child/SKILL.md", "nested");
	await ws.put(".mete/skills/lower/skill.md", "lowercase");
	await ws.put(".mete/skills/loose.txt", "not a folder");
	const result = await list();
	expect(
		result.ok && result.value.sources.map(({ scope, path }) => [scope, path]),
	).toEqual([
		["workspace", "one/SKILL.md"],
		["global", "one/SKILL.md"],
	]);
});

it("bounds root entries and refuses incomplete lookup", async () => {
	await put();
	const root = join(ws.workspaceDir, ".mete/skills");
	for (let i = 0; i < SKILL_ROOT_ENTRIES; i++)
		await fs.mkdir(join(root, `empty-${i}`));
	const reads = vi.spyOn(Dir.prototype, "read");
	const result = await list();
	expect(result).toMatchObject({
		ok: true,
		value: {
			complete: false,
			diagnostics: [{ code: "limit_exceeded", location: "root" }],
		},
	});
	expect(reads).toHaveBeenCalledTimes(SKILL_ROOT_ENTRIES);
	expect(
		await resolveSkillLocation(ws, { sourceId: "a".repeat(64) }, signal()),
	).toEqual({
		ok: false,
		error: { code: "limit_exceeded", location: "root" },
	});
});

it.each(["open", "read"])("reports root %s failure", async (operation) => {
	await put();
	if (operation === "open")
		vi.mocked(fs.opendir).mockRejectedValueOnce(new Error(ws.workspaceDir));
	else
		vi.spyOn(Dir.prototype, "read").mockRejectedValueOnce(
			new Error(ws.workspaceDir),
		);
	expect(await list()).toEqual({
		ok: false,
		error: { code: "unavailable", location: "root" },
	});
});

it("diagnoses canonical aliases without duplication", async () => {
	await put();
	const result = await listSkillSources(
		{ ...ws, globalDir: join(ws.workspaceDir, ".mete") },
		signal(),
	);
	expect(result).toMatchObject({
		ok: true,
		value: {
			sources: [{ scope: "workspace" }],
			diagnostics: [{ code: "bad_input", location: "path" }],
		},
	});
});

it("looks up current IDs after ignore edits and replacement", async () => {
	const file = await put();
	const inventory = await list();
	if (!inventory.ok) throw new Error("Expected an inventory");
	const source = inventory.value.sources[0];
	if (!source) throw new Error("Expected a source");
	const input = { sourceId: source.sourceId };
	expect(await resolveSkillLocation(ws, input, signal())).toMatchObject({
		ok: true,
		value: { source, file, metadata: { nlink: 1n } },
	});
	await ws.put(".meteignore", ".mete/skills/one/\n");
	expect(await resolveSkillLocation(ws, input, signal())).toMatchObject({
		ok: false,
		error: { code: "ignored" },
	});
	await ws.put(".meteignore", "");
	await fs.rename(
		join(ws.workspaceDir, ".mete/skills"),
		join(ws.workspaceDir, ".mete/old"),
	);
	await put();
	expect(await resolveSkillLocation(ws, input, signal())).toEqual({
		ok: false,
		error: { code: "not_found" },
	});
	expect(
		await resolveSkillLocation(ws, { sourceId: "../one" }, signal()),
	).toEqual({ ok: false, error: { code: "bad_input" } });
});

it("propagates cancellation during directory opening", async () => {
	await put();
	const controller = new AbortController();
	vi.mocked(fs.opendir).mockImplementationOnce(async () => {
		controller.abort();
		throw new Error("cancelled");
	});
	expect(await listSkillSources(ws, controller.signal)).toEqual({
		ok: false,
		error: { code: "aborted" },
	});
});
