import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type PolicyVerdict } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { officialInstall } from "../src/application/registry-add.js";
import { installOf } from "../src/domain/registry-install.js";
import { addMcpServer } from "../src/infrastructure/mcp-yaml.js";

const signal = new AbortController().signal;
const server = (more: object) => ({
	name: "io.github.A/Files_MCP",
	version: "1.2.0",
	packages: [],
	remotes: [],
	...more,
});

describe("the mcp.yaml entry of a registry server", () => {
	it("pins npm and pypi packages and names what the user must fill in", () => {
		const npm = {
			registryType: "npm",
			identifier: "@a/files",
			version: "1.2.0",
			environmentVariables: [
				{ name: "ROOT", isRequired: true },
				{ name: "DEBUG" },
			],
			packageArguments: [{ name: "dir", isRequired: true }],
		};
		expect(installOf(server({ packages: [npm] }))).toEqual({
			server: {
				id: "files-mcp",
				transport: "stdio",
				runtime: "node",
				command: "npx",
				args: ["-y", "@a/files@1.2.0"],
				permissions: [],
			},
			notes: [
				"set the environment variable ROOT under env",
				"add the required argument dir to args",
			],
		});
		const pypi = {
			registryType: "pypi",
			identifier: "files",
			version: "0.3",
			environmentVariables: [],
			packageArguments: [],
		};
		const p = installOf(server({ packages: [pypi] }));
		expect(typeof p !== "string" && p.server).toMatchObject({
			command: "uvx",
			args: ["files==0.3"],
		});
	});

	it("takes a remote with its transport, and refuses latest, oci and mcpb", () => {
		const remote = {
			type: "sse",
			url: "https://a.example/sse",
			headers: [{ name: "Authorization", isRequired: true }],
		};
		expect(installOf(server({ remotes: [remote] }))).toEqual({
			server: {
				id: "files-mcp",
				transport: "sse",
				url: "https://a.example/sse",
				auth: "none",
				permissions: [],
			},
			notes: [
				"it needs the header Authorization, which mcp.yaml cannot set yet",
			],
		});
		const pkg = (registryType: string, version = "1.0.0") => ({
			registryType,
			identifier: "x",
			version,
			environmentVariables: [],
			packageArguments: [],
		});
		expect(installOf(server({ packages: [pkg("npm", "latest")] }))).toMatch(
			/no pinned version/,
		);
		expect(installOf(server({ packages: [pkg("oci"), pkg("mcpb")] }))).toMatch(
			/oci, mcpb package is not added automatically; edit .mete\/mcp.yaml by hand/,
		);
	});
});

describe("adding a server to .mete/mcp.yaml", () => {
	let dir = "";
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mete-yaml-"));
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));
	const file = () => join(dir, ".mete", "mcp.yaml");
	const entry = {
		id: "files",
		transport: "stdio",
		runtime: "node",
		command: "npx",
		args: ["-y", "files@1.0.0"],
		permissions: [],
	} as const;

	it("creates the file, keeps comments and entries, and writes nothing on a refusal", async () => {
		expect(await addMcpServer(dir, entry)).toEqual(ok(file()));
		expect(await readFile(file(), "utf8")).toContain("id: files");
		const kept =
			"# my servers\nservers:\n  - id: other # keep me\n    transport: sse\n    url: https://a.example/sse\n";
		await writeFile(file(), kept);
		expect((await addMcpServer(dir, entry)).ok).toBe(true);
		const text = await readFile(file(), "utf8");
		expect(text).toMatch(/^# my servers\n/);
		expect(text).toContain("id: other # keep me");
		expect(text).toContain("  - id: files");
		const twice = await addMcpServer(dir, entry);
		expect(twice.ok === false && twice.error.message).toContain(
			"server ids must be unique",
		);
		const exa = await addMcpServer(dir, { ...entry, id: "exa" });
		expect(exa.ok === false && exa.error.message).toMatch(/built-in server id/);
		expect(await readFile(file(), "utf8")).toBe(text);
	});

	it("refuses a file that is not valid YAML without touching it", async () => {
		await mkdir(join(dir, ".mete"));
		await writeFile(file(), "servers: [\n");
		const r = await addMcpServer(dir, entry);
		expect(r.ok === false && r.error.code).toBe("bad_input");
		expect(await readFile(file(), "utf8")).toBe("servers: [\n");
	});
});

describe("looking up one registry server", () => {
	const deps = (verdict: PolicyVerdict["verdict"], res: () => Response) => {
		const urls: string[] = [];
		return {
			urls,
			deps: {
				adapterId: "official-mcp-registry",
				policy: () => ({
					check: () => ok({ verdict, rule: `kit:${verdict}` }),
				}),
				fetch: async (url: string | URL | Request) => {
					urls.push(String(url));
					return res();
				},
			},
		};
	};

	it("reads the newest version by name, and names a missing one", async () => {
		const pkg = { registryType: "npm", identifier: "files", version: "1.0.0" };
		const found = deps("allow", () =>
			Response.json({ server: server({ packages: [pkg] }) }),
		);
		const r = await officialInstall(found.deps, "io.github.a/files", {
			signal,
		});
		expect(found.urls).toEqual([
			"https://registry.modelcontextprotocol.io/v0.1/servers/io.github.a%2Ffiles/versions/latest",
		]);
		expect(r.ok && r.value.server.id).toBe("files-mcp");
		const gone = deps("allow", () => new Response("{}", { status: 404 }));
		const none = await officialInstall(gone.deps, "io.github.a/none", {
			signal,
		});
		expect(none.ok === false && none.error.code).toBe("not_found");
		const asked = deps("ask", () => Response.json({}));
		const a = await officialInstall(asked.deps, "x", { signal });
		expect(a.ok === false && a.error.code).toBe("approval_required");
		expect(asked.urls).toEqual([]);
	});
});
