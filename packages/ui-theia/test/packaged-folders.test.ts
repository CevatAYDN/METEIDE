import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packagedFolders } from "../src/infrastructure/spawn-cli.js";

// A packaged desktop ships templates/ and adapters/ as extra resources beside the app (ADR-115), so
// the daemon it spawns has to read those folders; in development neither folder exists there and the
// daemon keeps the repository's own.

let root: string | undefined;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("the folders a packaged app hands its daemon", () => {
	it("names the shipped templates and adapters folders, and only those present", async () => {
		root = await mkdtemp(join(tmpdir(), "mete-resources-"));
		expect(packagedFolders(root)).toEqual({});
		await mkdir(join(root, "templates"));
		expect(packagedFolders(root)).toEqual({
			METE_TEMPLATES_DIR: join(root, "templates"),
		});
		await mkdir(join(root, "adapters"));
		expect(packagedFolders(root)).toEqual({
			METE_TEMPLATES_DIR: join(root, "templates"),
			METE_ADAPTERS_DIR: join(root, "adapters"),
		});
	});

	it("names nothing outside Electron, where there is no resources folder", () => {
		expect(packagedFolders(undefined)).toEqual({});
	});
});
