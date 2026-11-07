import { ok, type RegistrySetupAdapter } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { officialInstall } from "../src/application/registry-add.js";
import { officialSetup } from "../src/application/registry-setup.js";
import { createRegistryModule } from "../src/registry-module.js";
import { moduleContext } from "./helpers/context.js";

const ctx = { signal: new AbortController().signal };
const pkg = { registryType: "npm", identifier: "files", version: "1.0.0" };
const remote = { type: "sse", url: "https://a.example/sse" };
const sentinel = "REGISTRY_SECRET_SENTINEL";
const answer = (more: object) => ({
	server: { name: "io.github.a/files", version: "1.0.0", ...more },
});
const deps = (body: unknown) => ({
	adapterId: "official-mcp-registry",
	policy: () => ({
		check: () => ok({ verdict: "allow" as const, rule: "kit" }),
	}),
	fetch: async () => Response.json(body),
});
const prepare = (more: object) =>
	officialSetup(deps(answer(more))).prepare("io.github.a/files", ctx);

describe("registry.setup@1", () => {
	it("retains env metadata and pinned selection, never registry values", async () => {
		const body = {
			packages: [
				{ registryType: "oci", identifier: "ignored" },
				{
					...pkg,
					environmentVariables: [
						{
							name: "API_KEY",
							description: "Get a key",
							isRequired: true,
							isSecret: true,
							value: sentinel,
							default: sentinel,
						},
					],
					packageArguments: [{ name: "--root", isRequired: true }],
				},
			],
			remotes: [remote],
		};
		const result = await prepare(body);
		expect(result.ok && result.value).toMatchObject({
			server: { command: "npx", args: ["-y", "files@1.0.0"] },
			source:
				"https://registry.modelcontextprotocol.io/v0.1/servers/io.github.a%2Ffiles/versions/latest",
			fields: [
				{
					kind: "env",
					name: "API_KEY",
					required: true,
					secret: true,
					description: "Get a key",
				},
			],
			notes: [
				"set the environment variable API_KEY under env",
				"add the required argument --root to args",
			],
			// Required package arguments still need explicit advanced setup.
			blocked: true,
		});
		expect(JSON.stringify(result)).not.toContain(sentinel);
	});

	it("supports header metadata without changing legacy prepare notes", async () => {
		const body = {
			remotes: [
				{
					...remote,
					headers: [
						{
							name: "Authorization",
							isRequired: true,
							isSecret: true,
							value: sentinel,
						},
						{ name: "X-Mode", description: "Mode" },
					],
				},
			],
		};
		const result = await prepare(body);
		expect(result.ok && result.value).toMatchObject({
			blocked: false,
			fields: [
				{ kind: "header", name: "Authorization", required: true, secret: true },
				{
					kind: "header",
					name: "X-Mode",
					required: false,
					secret: false,
					description: "Mode",
				},
			],
		});
		expect(JSON.stringify(result)).not.toMatch(
			/REGISTRY_SECRET_SENTINEL|mcp.yaml cannot set/,
		);
		const legacy = await officialInstall(
			deps(answer(body)),
			"io.github.a/files",
			ctx,
		);
		expect(legacy.ok && legacy.value.notes[0]).toContain(
			"mcp.yaml cannot set yet",
		);
	});

	it.each([
		{ ...pkg, environmentVariables: [{ name: "KEY", isRequired: "yes" }] },
		{ ...pkg, environmentVariables: [{ name: "KEY", description: 7 }] },
		{ ...pkg, environmentVariables: [{ name: "BAD-NAME" }] },
		{ ...pkg, environmentVariables: [{ name: "KEY", variables: { key: {} } }] },
		{ ...pkg, environmentVariables: [{ name: "KEY", choices: ["a"] }] },
		{ ...pkg, environmentVariables: [{ name: "KEY", isSecret: "yes" }] },
		{
			...pkg,
			packageArguments: [{ name: "--key", isSecret: true, value: sentinel }],
		},
		{ ...pkg, runtimeArguments: [{ name: "--key", value: sentinel }] },
		{ ...pkg, environmentVariables: null },
		{ ...pkg, transport: { type: "stdio", variables: {} } },
		{ ...pkg, environmentVariables: [{ name: "KEY" }, { name: "KEY" }] },
	])(
		"blocks unrepresentable package requirements without leaking values",
		async (entry) => {
			const result = await prepare({ packages: [entry] });
			expect(result.ok && result.value.blocked).toBe(true);
			expect(result.ok && result.value.notes.length).toBeGreaterThan(0);
			expect(JSON.stringify(result)).not.toContain(sentinel);
		},
	);

	it.each([
		"Host",
		"Connection",
		"Cookie",
		"Content-Length",
		"Transfer-Encoding",
		"Proxy-Authorization",
		"Bad Header",
	])("blocks invalid or reserved header %s", async (name) => {
		const result = await prepare({
			remotes: [{ ...remote, headers: [{ name }] }],
		});
		expect(result.ok && result.value.blocked).toBe(true);
	});
	it("blocks concrete endpoints with unsupported variables", async () => {
		const result = await prepare({ remotes: [{ ...remote, variables: {} }] });
		expect(result.ok && result.value.blocked).toBe(true);
	});
	it("never exposes failed HTTP bodies or fetch diagnostics", async () => {
		for (const fetch of [
			async () => new Response(sentinel, { status: 503 }),
			async () => {
				throw new Error(sentinel);
			},
		]) {
			const result = await officialSetup({ ...deps({}), fetch }).prepare(
				"io.github.a/files",
				ctx,
			);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain(sentinel);
		}
	});
	it.each([
		{ ...remote, url: "https://a.example/{key}" },
		{ ...remote, url: `https://user:${sentinel}@a.example/sse` },
		{ ...remote, url: `https://a.example/sse?api_key=${sentinel}` },
		{ type: "unsupported", url: remote.url },
	])(
		"refuses unsafe or unsupported endpoints without a draft",
		async (entry) => {
			const result = await prepare({ remotes: [entry] });
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain(sentinel);
		},
	);

	it("registers setup and refuses policy before fetching", async () => {
		const { ctx: moduleCtx, registry } = moduleContext("ask");
		const module = createRegistryModule({
			fetch: async () => {
				throw new Error("must not fetch");
			},
		});
		await module.activate(moduleCtx);
		const adapter = registry.resolve<RegistrySetupAdapter>("registry.setup@1");
		expect(module.manifest.provides).toContain("registry.setup@1");
		expect(
			adapter.ok &&
				(await adapter.value[0].impl.prepare("io.github.a/files", ctx)),
		).toMatchObject({ ok: false, error: { code: "approval_required" } });
	});
});
