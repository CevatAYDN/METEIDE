import { describe, expect, it } from "vitest";
import { importTools, prepareTool } from "../src/application/tool-setup.js";

const credentialUrl = (path = "") => {
	const url = new URL(path, "https://example.test");
	url.username = "user";
	url.password = "pass";
	return url.href;
};

describe("guided tool setup", () => {
	it("requires an explicit HTTP mode and validates ids and addresses", () => {
		expect(prepareTool({ mode: "remote", id: "", url: "" }).ok).toBe(false);
		expect(
			prepareTool({ mode: "remote", id: "demo", url: "https://example.test" })
				.ok,
		).toBe(false);
		expect(
			prepareTool({
				mode: "remote",
				id: "demo",
				url: "file:///secret",
				httpMode: "sse",
			}).ok,
		).toBe(false);
		expect(
			prepareTool({
				mode: "remote",
				id: "demo",
				url: "https://example.test",
				httpMode: "sse",
			}),
		).toMatchObject({
			ok: true,
			value: [{ id: "demo", transport: "sse", auth: "" }],
		});
	});

	it("keeps each argument intact and infers only exact npx and uvx programs", () => {
		expect(
			prepareTool({
				mode: "local",
				id: "demo",
				command: "npx",
				args: "-y\npackage@1\npath with spaces",
			}),
		).toMatchObject({
			ok: true,
			value: [
				{
					runtime: "node",
					command: "npx",
					args: "-y\npackage@1\npath with spaces",
				},
			],
		});
		expect(
			prepareTool({ mode: "local", id: "demo", command: "uvx" }),
		).toMatchObject({ ok: true, value: [{ runtime: "python" }] });
		expect(
			prepareTool({ mode: "local", id: "demo", command: "npx -y package" }).ok,
		).toBe(false);
		expect(
			prepareTool({ mode: "local", id: "demo", command: "custom" }).ok,
		).toBe(false);
		expect(
			prepareTool({
				mode: "local",
				id: "demo",
				command: "C:\\Program Files\\tool.exe",
				runtime: "container",
			}).ok,
		).toBe(true);
	});
});

describe("tool JSON imports", () => {
	it("validates binary download URLs before importing native servers", () => {
		const binary = {
			id: "download",
			transport: "stdio",
			runtime: "binary",
			command: "tool",
			sha256: "a".repeat(64),
		};
		for (const url of [
			credentialUrl("/tool.zip"),
			"https://example.test/tool.zip?token=secret",
			"https://example.test/tool.zip#secret",
		])
			expect(
				importTools(JSON.stringify({ servers: [{ ...binary, url }] })).ok,
			).toBe(false);
		expect(
			importTools(
				JSON.stringify({
					servers: [{ ...binary, url: "https://example.test/tool.zip" }],
				}),
			).ok,
		).toBe(true);
	});

	it("accepts strict external maps and native METE lists", () => {
		expect(
			importTools(
				JSON.stringify({
					mcpServers: {
						demo: { command: "npx", args: ["-y", "pkg@1", " a b "] },
					},
				}),
			),
		).toMatchObject({
			ok: true,
			value: [{ id: "demo", runtime: "node", args: "-y\npkg@1\n a b " }],
		});
		expect(
			importTools(
				JSON.stringify({
					servers: [
						{ id: "demo", transport: "sse", url: "https://example.test" },
					],
				}),
			),
		).toMatchObject({ ok: true, value: [{ auth: "" }] });
		expect(
			importTools(
				'{"mcpServers":{"demo":{"url":"https://example.test","type":"http"}}}',
			),
		).toMatchObject({ ok: true, value: [{ transport: "streamable-http" }] });
		expect(
			importTools('{"mcpServers":{"demo":{"url":"https://example.test"}}}').ok,
		).toBe(false);
		expect(
			importTools(
				'{"mcpServers":{"demo":{"url":"https://example.test"}}}',
				"streamable-http",
			),
		).toMatchObject({
			ok: true,
			value: [{ transport: "streamable-http" }],
		});
	});

	it("refuses unsupported fields and secrets instead of dropping them", () => {
		for (const entry of [
			{ command: "npx", args: [], env: { TOKEN: "secret" } },
			{
				url: "https://example.test",
				type: "http",
				headers: { Authorization: "secret" },
			},
			{ url: "https://example.test", type: "http", auth: "oauth" },
			{ command: "npx", args: [], disabled: true },
			{ command: "npx", args: ["--token=secret"] },
			{ url: "https://example.test?api_key=secret", type: "http" },
			{ url: credentialUrl(), type: "http" },
		])
			expect(
				importTools(JSON.stringify({ mcpServers: { demo: entry } })).ok,
			).toBe(false);
		expect(importTools('{"servers":[],"other":true}').ok).toBe(false);
		expect(importTools("{").ok).toBe(false);
		expect(importTools('{"mcpServers":{}}').ok).toBe(false);
	});

	it("refuses invalid native config, duplicates, credentials and lossy argv", () => {
		const remote = {
			id: "demo",
			transport: "sse",
			url: "https://example.test",
		};
		expect(importTools(JSON.stringify({ servers: [remote, remote] })).ok).toBe(
			false,
		);
		expect(
			importTools(JSON.stringify({ servers: [{ ...remote, headers: {} }] })).ok,
		).toBe(false);
		expect(
			importTools(JSON.stringify({ servers: [{ ...remote, auth: "oauth" }] })),
		).toMatchObject({ ok: true, value: [{ auth: "oauth" }] });
		expect(
			importTools(
				JSON.stringify({
					servers: [
						{
							id: "local",
							transport: "stdio",
							runtime: "node",
							command: "npx",
							args: ["a\nb"],
						},
					],
				}),
			).ok,
		).toBe(false);
		expect(
			importTools('{"mcpServers":{"demo":{"command":"node","args":[]}}}').ok,
		).toBe(false);
		expect(
			importTools('{"mcpServers":{"demo":{"command":"npx","args":["a\\nb"]}}}')
				.ok,
		).toBe(false);
	});
});
