import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { templateValidate } from "../src/application/templates.js";
import { recordingIo } from "./helpers.js";

// `mete template validate` over the repository's built-in templates and a workspace folder.

const BUILT_IN = fileURLToPath(new URL("../../../templates/", import.meta.url));

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

const workspace = async (files: Record<string, string>) => {
	dir = await mkdtemp(join(tmpdir(), "mete-tpl-"));
	await mkdir(join(dir, ".mete", "teams"), { recursive: true });
	for (const [name, text] of Object.entries(files))
		await writeFile(join(dir, ".mete", "teams", name), text);
	return { builtIn: BUILT_IN, workspace: dir };
};

describe("mete template validate", () => {
	it("passes every built-in template", async () => {
		const t = recordingIo();
		expect(await templateValidate(await workspace({}), t.io)).toBe(0);
		expect(t.out).toContain("research  ok");
		expect(t.err).toEqual([]);
	});

	it("names each issue of a template that does not load, and checks one template by id", async () => {
		const dirs = await workspace({
			"broken.yaml": "metadata: { id: other }\n",
		});
		const all = recordingIo();
		expect(await templateValidate(dirs, all.io)).toBe(1);
		expect(all.err.some((l) => l.startsWith("broken  "))).toBe(true);
		const one = recordingIo();
		expect(await templateValidate(dirs, one.io, "research")).toBe(0);
		expect(one.out).toEqual(["research  ok"]);
		expect(await templateValidate(dirs, recordingIo().io, "nope")).toBe(1);
	});
});
