import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolAdapter } from "@mete/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpClientModule } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const signal = new AbortController().signal;
const server = {
	id: "fixture",
	transport: "stdio",
	runtime: "node",
	command: process.execPath,
	args: [FIXTURE],
};

const mapping = (id: string, output: string) => `apiVersion: mete/v1
kind: AdapterMapping
metadata: { id: ${id}, version: 1.0.0 }
type: mcp
server: fixture
implements:
  web.search@1:
    tool: web_search_advanced_exa
    action: net.fetch
    args: { query: "{{input.query}}", numResults: "{{input.maxResults}}" }
    output:
      results:
        each: "{{result.results}}"
        as: { title: "{{item.title}}", url: "{{item.url}}", ${output} }
`;

describe("level 2 MCP mappings", () => {
	let dir = "";
	let module: ReturnType<typeof createMcpClientModule>;
	let found: (id: string) => ToolAdapter<unknown, unknown> | undefined;
	let warnings: string[] = [];
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "mete-adapters-"));
		await writeFile(
			join(dir, "good.yaml"),
			mapping("good-search", `snippet: "{{item.highlights | join(' ')}}"`),
		);
		await writeFile(join(dir, "bad.yaml"), mapping("bad-search", `other: "x"`));
		await writeFile(
			join(dir, "cli.yaml"),
			"apiVersion: mete/v1\nkind: AdapterMapping\nmetadata: { id: a-cli, version: 1.0.0 }\ntype: cli\nimplements: {}\n",
		);
		await writeFile(join(dir, "broken.yaml"), "kind: [");
		module = createMcpClientModule({
			workspaceDir: tmpdir(),
			adaptersDir: dir,
		});
		const c = moduleContext("allow", { mcp: { servers: [server] } });
		warnings = c.warnings;
		expect((await module.activate(c.ctx)).ok).toBe(true);
		const r = c.registry.resolve<ToolAdapter<unknown, unknown>>("web.search@1");
		found = (id) => (r.ok ? r.value.find((a) => a.id === id)?.impl : undefined);
	});
	afterAll(async () => {
		await module.deactivate();
		await rm(dir, { recursive: true, force: true });
	});

	it("maps the input onto the tool and its JSON answer onto web.search@1", async () => {
		expect(
			await found("good-search")?.run(
				{ query: "mete", maxResults: 1 },
				{ signal },
			),
		).toEqual({
			ok: true,
			value: {
				results: [
					{ title: "mete", url: "https://r0.example/", snippet: "one two" },
				],
			},
		});
	});

	it("names the mapping, capability and field of an answer that fails the schema", async () => {
		const r = await found("bad-search")?.run({ query: "mete" }, { signal });
		expect(r?.ok === false && r.error.message).toMatch(
			/^mapping bad-search for web\.search@1: output results\.0/,
		);
	});

	it("logs every file it cannot run", () => {
		expect(warnings).toEqual([
			expect.stringMatching(/kind|apiVersion|Flow|YAML|expected/i),
			"type cli is not supported yet",
		]);
	});
});

describe("the shipped Exa mapping", () => {
	it("maps web.search@1 onto an exa server; mcp.yaml's exa replaces the built-in one", async () => {
		const adaptersDir = fileURLToPath(
			new URL("../../../adapters/", import.meta.url),
		);
		const module = createMcpClientModule({
			workspaceDir: tmpdir(),
			adaptersDir,
		});
		const c = moduleContext("allow", {
			mcp: { servers: [{ ...server, id: "exa" }] },
		});
		expect((await module.activate(c.ctx)).ok).toBe(true);
		const r = c.registry.resolve<ToolAdapter<unknown, unknown>>("web.search@1");
		const exa = r.ok
			? r.value.find((a) => a.id === "exa-mcp")?.impl
			: undefined;
		const out = await exa?.run({ query: "mete" }, { signal });
		expect(out?.ok && out.value).toEqual({
			results: [0, 1].map((i) => ({
				title: "mete",
				url: `https://r${i}.example/`,
				snippet: "one two",
			})),
		});
		expect(c.warnings).toEqual([]);
		await module.deactivate();
	});
});
