import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { recordingIo, silent, tempRepo } from "./helpers.js";

// mete vault restore (docs/11, Aging and restore; ADR-173): a vault note's versions, newest first,
// or one brought back after the note as it is now is kept; no module starts.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const STAMP = "2026-10-20T09-00-00-000Z";

const folder = async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	close = repo.close;
	const put = async (path: string, text: string) => {
		const file = join(repo.workspaceDir, ".mete/knowledge", path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text, "utf8");
	};
	await put("lessons/a.md", "now\n");
	await put(`.history/lessons/a.md/${STAMP}.md`, "before\n");
	const env = {
		cwd: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
	};
	const vault = async (...argv: string[]) => {
		const t = recordingIo();
		const code = await main(["vault", ...argv], t.io, env);
		return { code, out: t.out, err: t.err };
	};
	const note = () =>
		readFile(join(repo.workspaceDir, ".mete/knowledge/lessons/a.md"), "utf8");
	return { vault, note };
};

describe("mete vault restore (ADR-173)", () => {
	it("lists a note's versions, then brings one back and names where the old text went", async () => {
		const { vault, note } = await folder();
		expect(await vault("restore", "lessons/a.md")).toEqual({
			code: 0,
			out: [STAMP],
			err: [],
		});
		const r = await vault("restore", "lessons/a.md", STAMP);
		expect(r.code).toBe(0);
		expect(r.out[0]).toBe(`lessons/a.md is back as it was at ${STAMP}.`);
		expect(r.out[1]).toMatch(
			/^What it held before is kept as \.mete\/knowledge\/\.history\/lessons\/a\.md\//,
		);
		expect(await note()).toBe("before\n");
	});

	it("exits 1 for a path outside the vault or a version it does not keep, and on a bad subcommand", async () => {
		const { vault, note } = await folder();
		expect((await vault("restore", "../x.md")).code).toBe(1);
		expect(
			await vault("restore", "lessons/a.md", "2026-01-01T00-00-00-000Z"),
		).toMatchObject({
			code: 1,
			err: [expect.stringContaining("has no version")],
		});
		expect((await vault("list")).code).toBe(1);
		expect(await note()).toBe("now\n");
	});
});
