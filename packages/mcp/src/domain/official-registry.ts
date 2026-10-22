import type { RegistryEntry } from "@mete/contracts";
import { z } from "zod";

// The official MCP registry's servers as registry.search@1 entries (docs/10, Registries). Only the
// fields METE uses are read; a server that does not fit is left out, never the whole answer.

const PackageSchema = z.object({
	registryType: z.string(),
	identifier: z.string().min(1),
	fileSha256: z.string().optional(),
});
const ServerSchema = z.object({
	name: z.string().min(1),
	description: z.string().default(""),
	version: z.string().min(1),
	packages: z.array(PackageSchema).default([]),
	remotes: z.array(z.object({ url: z.url() })).default([]),
});

/** The answer of GET /v0.1/servers. */
export const OfficialAnswerSchema = z.object({
	servers: z.array(z.object({ server: z.unknown() })),
});

const RUNTIMES = {
	npm: "node",
	pypi: "python",
	oci: "container",
	mcpb: "binary",
} as const;
const known = (t: string): t is keyof typeof RUNTIMES => t in RUNTIMES;
const SHA256 = /^[0-9a-f]{64}$/;

const where = (s: z.output<typeof ServerSchema>) => {
	const pkg = s.packages.find((p) => known(p.registryType));
	if (pkg && known(pkg.registryType)) {
		const sha256 = pkg.fileSha256?.toLowerCase();
		const binary = pkg.registryType === "mcpb";
		return {
			runtime: RUNTIMES[pkg.registryType],
			source: binary ? pkg.identifier : `${pkg.registryType}:${pkg.identifier}`,
			...(binary && sha256 && SHA256.test(sha256) ? { sha256 } : {}),
		};
	}
	const remote = s.remotes[0];
	return remote
		? { runtime: "remote" as const, source: remote.url }
		: undefined;
};

/** The entries of an answer's servers; one with no known package and no remote is left out. */
export const officialEntries = (
	servers: readonly { server: unknown }[],
): RegistryEntry[] =>
	servers.flatMap(({ server }) => {
		const s = ServerSchema.safeParse(server);
		const from = s.success ? where(s.data) : undefined;
		if (!s.success || !from) return [];
		const { name, version, description } = s.data;
		return [
			{ id: name, kind: "mcp", version, description, ...from, permissions: [] },
		];
	});
