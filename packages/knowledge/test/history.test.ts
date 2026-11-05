import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { restoreVersion, versionsOf } from "../src/infrastructure/history.js";

// `mete vault restore` (docs/11, Aging and restore; ADR-173): a note's versions in .history/, newest
// first, and one brought back after the note as it is now is kept.

const roots: string[] = [];
afterAll(() =>
	Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))),
);

const OLD = "2026-10-01T09-00-00-000Z";
const NEW = "2026-10-20T09-00-00-000Z";
const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const HISTORY = ".mete/knowledge/.history/lessons/a.md";

const vault = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-history-"));
	roots.push(root);
	const put = async (path: string, text: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), text, "utf8");
	};
	await put(`${HISTORY}/${OLD}.md`, "oldest\n");
	await put(`${HISTORY}/${NEW}.md`, "newer\n");
	await put(`${HISTORY}/notes.txt`, "not a version\n");
	await put(".mete/knowledge/lessons/a.md", "now\n");
	const read = (path: string) => readFile(join(root, path), "utf8");
	return { root, put, read };
};

describe("versionsOf", () => {
	it("lists a note's versions newest first, and none for a note without history", async () => {
		const v = await vault();
		expect(await versionsOf(v.root, "lessons/a.md")).toEqual({
			ok: true,
			value: [NEW, OLD],
		});
		expect(await versionsOf(v.root, "lessons/b.md")).toEqual({
			ok: true,
			value: [],
		});
	});

	it("refuses a path outside the vault or inside its history", async () => {
		const v = await vault();
		for (const path of ["../a.md", ".history/lessons/a.md", "lessons/a.txt"])
			expect((await versionsOf(v.root, path)).ok).toBe(false);
	});
});

describe("restoreVersion", () => {
	it("keeps the note as it is now, then writes the version back as it was", async () => {
		const v = await vault();
		const r = await restoreVersion(v.root, "lessons/a.md", OLD, NOW);
		expect(r).toEqual({
			ok: true,
			value: { kept: `${HISTORY}/2026-10-31T12-00-00-000Z.md` },
		});
		expect(await v.read(".mete/knowledge/lessons/a.md")).toBe("oldest\n");
		expect(await v.read(`${HISTORY}/2026-10-31T12-00-00-000Z.md`)).toBe(
			"now\n",
		);
		expect((await readdir(join(v.root, HISTORY))).length).toBe(4);
	});

	it("brings back a deleted note with nothing to keep", async () => {
		const v = await vault();
		await rm(join(v.root, ".mete/knowledge/lessons/a.md"));
		expect(await restoreVersion(v.root, "lessons/a.md", NEW, NOW)).toEqual({
			ok: true,
			value: {},
		});
		expect(await v.read(".mete/knowledge/lessons/a.md")).toBe("newer\n");
	});

	it("refuses a stamp that names no version, and changes nothing", async () => {
		const v = await vault();
		for (const stamp of ["2026-01-01T00-00-00-000Z", "../../lessons/a"]) {
			const r = await restoreVersion(v.root, "lessons/a.md", stamp, NOW);
			expect(r.ok ? "" : r.error).toContain("has no version");
		}
		expect(await v.read(".mete/knowledge/lessons/a.md")).toBe("now\n");
	});

	it("refuses a path outside the vault with the same error as versionsOf, and writes nothing", async () => {
		const v = await vault();
		const outside = join(v.root, "x.md");
		for (const path of ["../x.md", outside, ".history/lessons/a.md"]) {
			const listed = await versionsOf(v.root, path);
			const r = await restoreVersion(v.root, path, OLD, NOW);
			expect(listed.ok).toBe(false);
			expect(r).toEqual(listed);
			expect(r.ok ? "" : r.error).toContain("is not a .md note inside");
		}
		expect(await v.read(".mete/knowledge/lessons/a.md")).toBe("now\n");
		await expect(readFile(outside, "utf8")).rejects.toThrow();
		await expect(
			readFile(join(v.root, "..", "x.md"), "utf8"),
		).rejects.toThrow();
		expect((await readdir(join(v.root, HISTORY))).length).toBe(3);
	});
});
