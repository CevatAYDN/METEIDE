import { tmpdir } from "node:os";
import { McpServerSchema, ok, type SecretStore } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { credentialFetch } from "../src/infrastructure/credential-fetch.js";
import { createCredentialFields } from "../src/infrastructure/credential-fields.js";

const server = McpServerSchema.parse({
	id: "remote",
	transport: "streamable-http",
	url: "https://example.test/mcp",
});
const store = (): SecretStore => {
	const values = new Map<string, string>();
	return {
		get: async (name) => ok(values.get(name)),
		set: async (name, value) => ok(void values.set(name, value)),
		delete: async (name) => ok(values.delete(name)),
	};
};
const signal = new AbortController().signal;
describe("write-only credential fields", () => {
	it("preserves omitted optional secrets and serializes independent replacements", async () => {
		const secrets = store();
		const a = {
			kind: "header" as const,
			name: "X-A",
			required: false,
			secret: true,
		};
		const b = { ...a, name: "X-B" };
		const first = createCredentialFields(secrets, tmpdir());
		expect(
			(
				await first.save(
					{
						expected: server,
						fields: [a, b],
						values: { "header:X-A": "old-a", "header:X-B": "old-b" },
					},
					signal,
				)
			).ok,
		).toBe(true);
		expect(
			(
				await first.save(
					{ expected: server, fields: [a], values: { "header:X-A": "new-a" } },
					signal,
				)
			).ok,
		).toBe(true);
		expect(await first.load(server)).toMatchObject({
			ok: true,
			value: { values: { "header:X-A": "new-a", "header:X-B": "old-b" } },
		});
		const second = createCredentialFields(secrets, tmpdir());
		expect(
			(
				await Promise.all([
					first.save(
						{
							expected: server,
							fields: [a],
							values: { "header:X-A": "latest-a" },
						},
						signal,
					),
					second.save(
						{
							expected: server,
							fields: [b],
							values: { "header:X-B": "latest-b" },
						},
						signal,
					),
				])
			).every((result) => result.ok),
		).toBe(true);
		expect(await first.load(server)).toMatchObject({
			ok: true,
			value: { values: { "header:X-A": "latest-a", "header:X-B": "latest-b" } },
		});
	});
	it("sanitizes an HTTP 200 OAuth error without rewriting successful MCP data", async () => {
		const fake: typeof fetch = async () =>
			new Response(
				JSON.stringify({
					error: "invalid_grant",
					error_description: "private-refresh-sentinel",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const guarded = credentialFetch(fake, {
			endpoint: "https://example.test/mcp",
			signal,
		});
		const token = await guarded("https://example.test/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "grant_type=refresh_token",
		});
		expect(await token.json()).toEqual({
			error: "invalid_grant",
			error_description: "MCP authorization request failed",
		});
		const mcp = await guarded("https://example.test/mcp");
		expect(await mcp.text()).toContain("private-refresh-sentinel");
	});
	it("does not pass server error descriptions to SDK diagnostic logging", async () => {
		const fake: typeof fetch = async () =>
			new Response(
				JSON.stringify({
					error: "invalid_grant",
					error_description: "private-refresh-sentinel",
				}),
				{ status: 400, headers: { "content-type": "application/json" } },
			);
		const guarded = credentialFetch(fake, {
			endpoint: "https://example.test/mcp",
			signal,
		});
		const response = await guarded("https://example.test/token");
		expect(await response.json()).toEqual({
			error: "invalid_grant",
			error_description: "MCP authorization request failed",
		});
	});
	it("keeps values out of states and separate from another endpoint", async () => {
		const fields = createCredentialFields(store(), tmpdir());
		expect(
			(
				await fields.save(
					{
						expected: server,
						fields: [
							{ kind: "header", name: "X-Key", required: true, secret: true },
						],
						values: { "header:X-Key": "private-sentinel" },
					},
					signal,
				)
			).ok,
		).toBe(true);
		const loaded = await fields.load(server);
		expect(loaded.ok && loaded.value?.values["header:X-Key"]).toBe(
			"private-sentinel",
		);
		expect(await fields.load({ ...server, id: "other" })).toEqual(
			ok(undefined),
		);
	});

	it("only sends headers to the exact endpoint and never follows redirects", async () => {
		const seen: Request[] = [];
		const fake: typeof fetch = async (input, init) => {
			seen.push(new Request(input, init));
			return new Response("", {
				status: 302,
				headers: { location: "https://example.test/other" },
			});
		};
		const guarded = credentialFetch(fake, {
			endpoint: "https://example.test/mcp",
			headers: { "X-Key": "private-sentinel" },
			signal,
		});
		await expect(guarded("https://example.test/mcp")).rejects.toThrow(
			"redirect",
		);
		expect(seen[0]?.headers.get("X-Key")).toBe("private-sentinel");
		expect(seen[0]?.redirect).toBe("manual");
		await guarded(
			"https://example.test/.well-known/oauth-protected-resource",
		).catch(() => undefined);
		expect(seen[1]?.headers.get("X-Key")).toBeNull();
		await expect(
			guarded("https://example.test/other", {
				headers: { Authorization: "Bearer private-sentinel" },
			}),
		).rejects.toThrow("endpoint");
		expect(seen).toHaveLength(2);
	});
});
