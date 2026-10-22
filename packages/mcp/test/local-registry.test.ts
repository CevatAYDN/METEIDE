import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryEntry } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localRegistry } from "../src/application/local-registry.js";
import { REGISTRY_SEARCH_LIMIT } from "../src/defaults.js";

const signal = new AbortController().signal;
const ctx = { signal };

const entry = (more: Partial<RegistryEntry>): RegistryEntry => ({
	id: "files",
	kind: "mcp",
	version: "1.0.0",
	description: "Files on disk",
	source: "npm:files-mcp",
	runtime: "node",
	permissions: [],
	...more,
});

let dir = "";
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "mete-localreg-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const index = async (text: string) => {
	await mkdir(join(dir, "registry"), { recursive: true });
	await writeFile(join(dir, "registry", "index.json"), text);
};
const found = async (query: string, kind?: RegistryEntry["kind"]) => {
	const r = await localRegistry(dir).run(
		kind ? { query, kind } : { query },
		ctx,
	);
	if (!r.ok) throw new Error(r.error.message);
	return r.value.entries.map((e) => e.id);
};
const refused = async (query = "x") => {
	const r = await localRegistry(dir).run({ query }, ctx);
	return r.ok ? undefined : r.error;
};

describe("local registry", () => {
	it("is empty when nobody set it up", async () => {
		expect(await found("anything")).toEqual([]);
	});

	it("matches every word in the id or the description, in any case, and the kind asked for", async () => {
		const entries = [
			entry({ id: "files" }),
			entry({ id: "seo-audit", kind: "template", description: "SEO team" }),
			entry({ id: "seo-notes", description: "Notes for an SEO lead" }),
		];
		await index(JSON.stringify({ entries }));
		expect(await found("FILES")).toEqual(["files"]);
		expect(await found("seo")).toEqual(["seo-audit", "seo-notes"]);
		expect(await found("seo lead")).toEqual(["seo-notes"]);
		expect(await found("seo", "template")).toEqual(["seo-audit"]);
		expect(await found("nothing like it")).toEqual([]);
	});

	it("answers at most as many entries as the official registry does", async () => {
		const entries = Array.from({ length: REGISTRY_SEARCH_LIMIT + 5 }, (_, i) =>
			entry({ id: `server-${i}` }),
		);
		await index(JSON.stringify({ entries }));
		expect(await found("server")).toHaveLength(REGISTRY_SEARCH_LIMIT);
	});

	it("names the file when it is not JSON, has the wrong shape, or repeats an entry", async () => {
		const file = join(dir, "registry", "index.json");
		await index("{ nope");
		const json = await refused();
		expect(json?.code).toBe("io");
		expect(json?.message).toBe(`local registry ${file}: is not valid JSON`);
		await index(
			JSON.stringify({ entries: [entry({ runtime: "perl" as never })] }),
		);
		expect((await refused())?.message).toContain(`local registry ${file}:`);
		await index(JSON.stringify({ entries: [entry({}), entry({})] }));
		expect((await refused())?.message).toContain("only once");
		// The same id as another kind is a different entry.
		await index(
			JSON.stringify({ entries: [entry({}), entry({ kind: "plugin" })] }),
		);
		expect(await found("files")).toEqual(["files", "files"]);
	});

	it("refuses an empty query as bad input", async () => {
		expect((await refused(" "))?.code).toBe("bad_input");
	});
});
