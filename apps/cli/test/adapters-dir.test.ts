import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, silent, tempRepo } from "./helpers.js";

// The composition reads its level 2 mapping files from adaptersDir (ADR-115): a packaged desktop ships
// the repository's adapters/ beside the app and names it through METE_ADAPTERS_DIR, so an empty folder
// has to mean no mapping adapter at all.

const offline: typeof fetch = async () => new Response("", { status: 404 });

/** The ids of the adapters that carry web.search@1, from the folder the app is given. */
const adapterIds = async (adaptersDir?: string) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	try {
		const made = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			...(adaptersDir ? { adaptersDir } : {}),
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
			fetch: offline,
		});
		if (!made.ok) throw new Error("the app did not start");
		try {
			const resolved = made.value.registry.resolve<unknown>("web.search@1");
			return resolved.ok ? resolved.value.map((a) => a.id) : [];
		} finally {
			await made.value.stop();
		}
	} finally {
		await repo.close();
	}
};

describe("the adapters folder", () => {
	it("loads the repository's mappings by default and none from an empty folder (ADR-115)", async () => {
		expect(await adapterIds()).toContain("exa-mcp");
		const empty = await mkdtemp(join(tmpdir(), "mete-adapters-"));
		expect(await adapterIds(empty)).not.toContain("exa-mcp");
	});
});
