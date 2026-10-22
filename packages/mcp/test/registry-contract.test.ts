import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type PolicyCheckAdapter } from "@mete/contracts";
import { registrySearchContract } from "@mete/testing";
import { localRegistry } from "../src/application/local-registry.js";
import { officialRegistry } from "../src/application/registry-search.js";

// The official registry as a fake backend that, like the real one, filters on the search words
// and honours the limit it is given.
registrySearchContract("official MCP registry", async (world) => {
	const policy: PolicyCheckAdapter = {
		check: () => ok({ verdict: "allow", rule: "kit" }),
	};
	const fake: typeof fetch = async (url) => {
		if (world === "down") return new Response("down", { status: 503 });
		const params = new URL(String(url)).searchParams;
		const words = (params.get("search") ?? "").toLowerCase();
		const servers = world.entries
			.filter((e) => `${e.id} ${e.description}`.toLowerCase().includes(words))
			.slice(0, Number(params.get("limit")))
			.map((e) => ({
				server: {
					name: e.id,
					description: e.description,
					version: e.version,
					packages: [
						{ registryType: "npm", identifier: e.source.replace("npm:", "") },
					],
				},
			}));
		return Response.json({ servers });
	};
	return {
		adapter: officialRegistry({
			adapterId: "official-mcp-registry",
			policy: () => policy,
			fetch: fake,
		}),
		close: async () => {},
	};
});

// The local registry over a global folder; an unreadable registry is a file that is not JSON.
registrySearchContract("local registry", async (world) => {
	const dir = await mkdtemp(join(tmpdir(), "mete-registry-kit-"));
	await mkdir(join(dir, "registry"));
	await writeFile(
		join(dir, "registry", "index.json"),
		world === "down" ? "{ nope" : JSON.stringify({ entries: world.entries }),
	);
	return {
		adapter: localRegistry(dir),
		close: () => rm(dir, { recursive: true, force: true }),
	};
});
