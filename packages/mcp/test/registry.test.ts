import type { PolicyVerdict, RegistrySearchAdapter } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createRegistryModule } from "../src/registry-module.js";
import { moduleContext } from "./helpers/context.js";

const signal = new AbortController().signal;
const sha = "AB".repeat(32);
const servers = [
	{
		server: {
			name: "io.github.a/files",
			description: "Files",
			version: "0.1.4",
			packages: [
				{ registryType: "nuget", identifier: "Files" },
				{ registryType: "pypi", identifier: "files-mcp" },
			],
		},
	},
	{
		server: {
			name: "io.github.a/tool",
			version: "1.0.0",
			packages: [
				{
					registryType: "mcpb",
					identifier: "https://a.example/tool.mcpb",
					fileSha256: sha,
				},
			],
		},
	},
	{
		server: {
			name: "io.github.a/hosted",
			description: "Hosted",
			version: "2.0.0",
			remotes: [{ type: "sse", url: "https://a.example/sse" }],
		},
	},
	{ server: { name: "io.github.a/none", version: "1.0.0" } },
	{ server: { name: "io.github.a/broken" } },
];

const start = async (
	verdict: PolicyVerdict["verdict"],
	answer: () => Response,
) => {
	const urls: string[] = [];
	const module = createRegistryModule({
		fetch: async (url) => {
			urls.push(String(url));
			return answer();
		},
	});
	const { ctx, registry } = moduleContext(verdict);
	await module.activate(ctx);
	const r = registry.resolve<RegistrySearchAdapter>("registry.search@1");
	return { search: r.ok ? r.value[0].impl : undefined, urls };
};

describe("registry.search@1 over the official MCP registry", () => {
	it("asks for the newest versions and maps each server to its runtime and source", async () => {
		const { search, urls } = await start("allow", () =>
			Response.json({ servers }),
		);
		const r = await search?.run({ query: "files" }, { signal });
		expect(urls).toEqual([
			"https://registry.modelcontextprotocol.io/v0.1/servers?search=files&version=latest&limit=20",
		]);
		const entry = (id: string, version: string, rest: object) => ({
			id: `io.github.a/${id}`,
			kind: "mcp",
			version,
			permissions: [],
			...rest,
		});
		expect(r).toEqual({
			ok: true,
			value: {
				entries: [
					entry("files", "0.1.4", {
						description: "Files",
						runtime: "python",
						source: "pypi:files-mcp",
					}),
					entry("tool", "1.0.0", {
						description: "",
						runtime: "binary",
						source: "https://a.example/tool.mcpb",
						sha256: sha.toLowerCase(),
					}),
					entry("hosted", "2.0.0", {
						description: "Hosted",
						runtime: "remote",
						source: "https://a.example/sse",
					}),
				],
			},
		});
	});

	it("asks the policy first, finds no other kind and reports a bad answer as io", async () => {
		const asked = await start("ask", () => Response.json({ servers }));
		const r = await asked.search?.run({ query: "files" }, { signal });
		expect(r?.ok === false && r.error.code).toBe("approval_required");
		expect(
			await asked.search?.run({ query: "x", kind: "skill" }, { signal }),
		).toEqual({ ok: true, value: { entries: [] } });
		expect(asked.urls).toEqual([]);
		for (const answer of [
			() => new Response("down", { status: 503 }),
			() => new Response("not json"),
			() => Response.json({ items: [] }),
		]) {
			const bad = await start("allow", answer);
			const out = await bad.search?.run({ query: "files" }, { signal });
			expect(out?.ok === false && out.error).toMatchObject({
				code: "io",
				message: expect.stringMatching(/^official MCP registry: /),
			});
		}
	});
});
