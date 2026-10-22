import { afterEach, describe, expect, it } from "vitest";
import { registryCommand } from "../src/application/registry.js";
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
});
