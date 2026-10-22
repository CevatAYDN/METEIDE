import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	registryAddCommand,
	registryCommand,
} from "../src/application/registry.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

let close = async () => {};
afterEach(() => close());

const servers = [
	{
		server: {
			name: "io.github.a/files",
			description: "Files on disk",
			version: "0.1.4",
			packages: [{ registryType: "npm", identifier: "files-mcp" }],
		},
	},
];

describe("mete registry search", () => {
	it("lists the official registry's entries through registry.search@1 and installs nothing", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const asked: string[] = [];
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
			fetch: async (url) => {
				asked.push(String(url));
				return Response.json({ servers: asked.length === 1 ? servers : [] });
			},
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		expect(await registryCommand(app.value, t.io, "files")).toBe(0);
		expect(t.out).toEqual([
			"io.github.a/files 0.1.4  node  npm:files-mcp",
			"  Files on disk",
		]);
		const none = recordingIo();
		expect(await registryCommand(app.value, none.io, "nothing")).toBe(0);
		expect(none.out).toEqual(['no entries for "nothing"']);
		expect(
			asked.every((u) =>
				u.startsWith("https://registry.modelcontextprotocol.io/"),
			),
		).toBe(true);
	});

	it("adds a server's newest version to .mete/mcp.yaml and refuses it twice", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const pkg = {
			registryType: "pypi",
			identifier: "files-mcp",
			version: "0.3.1",
			environmentVariables: [{ name: "ROOT", isRequired: true }],
		};
		const record = {
			server: { name: "io.github.a/files", version: "0.3.1", packages: [pkg] },
		};
		const fetch = async () => Response.json(record);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
			fetch,
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const target = {
			name: "io.github.a/files",
			workspaceDir: repo.workspaceDir,
			fetch,
		};
		const t = recordingIo();
		expect(await registryAddCommand(app.value, t.io, target)).toBe(0);
		const file = join(repo.workspaceDir, ".mete", "mcp.yaml");
		expect(t.out).toEqual([
			`added files to ${file}: uvx files-mcp==0.3.1`,
			"the registry names no permissions for it; check what it can reach before a run uses it",
			"to do: set the environment variable ROOT under env",
		]);
		expect(await readFile(file, "utf8")).toContain("command: uvx");
		const again = recordingIo();
		expect(await registryAddCommand(app.value, again.io, target)).toBe(1);
		expect(again.err[0]).toContain("server ids must be unique");
	});
});

describe("mete registry search across the chain", () => {
	const mine = {
		id: "seo-team",
		kind: "template",
		version: "1.0.0",
		description: "Files for my SEO team",
		source: "https://example.org/seo-team.yaml",
		runtime: "remote",
		permissions: [],
	};
	// The official registry answers with `official`, or with an error status; the local one holds `mine`.
	const search = async (official: unknown, query: string) => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(join(repo.globalDir, "registry"), { recursive: true });
		await writeFile(
			join(repo.globalDir, "registry", "index.json"),
			JSON.stringify({ entries: [mine] }),
		);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
			fetch: async () =>
				official === undefined
					? new Response("down", { status: 503 })
					: Response.json({ servers: official }),
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		return { code: await registryCommand(app.value, t.io, query), t };
	};

	it("asks the local registry when the official one finds nothing", async () => {
		const r = await search([], "seo");
		expect(r.code).toBe(0);
		expect(r.t.out).toEqual([
			"seo-team 1.0.0  remote  https://example.org/seo-team.yaml",
			"  Files for my SEO team",
		]);
	});

	it("keeps the official answer when it has entries, and reports a broken registry that nobody made up for", async () => {
		const official = await search(servers, "files");
		expect(official.t.out[0]).toBe(
			"io.github.a/files 0.1.4  node  npm:files-mcp",
		);
		expect(official.t.out).toHaveLength(2);
		await close();
		const down = await search(undefined, "nothing-matches");
		expect(down.code).toBe(1);
		expect(down.t.err[0]).toMatch(/official MCP registry: answered 503/);
	});

	it("falls back to the local registry when the official one is down", async () => {
		const r = await search(undefined, "seo");
		expect(r.code).toBe(0);
		expect(r.t.out[0]).toMatch(/^seo-team 1\.0\.0/);
	});
});
