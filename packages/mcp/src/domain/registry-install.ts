import type { McpServer } from "@mete/contracts";
import { z } from "zod";

// The mcp.yaml entry for one official registry server, for `mete registry add` (docs/10,
// Registries): npm and pypi packages pinned to their version, or a remote; never oci or mcpb.

const Named = z.object({
	name: z.string().min(1),
	isRequired: z.boolean().optional(),
});
const PackageSchema = z.object({
	registryType: z.string(),
	identifier: z.string().min(1),
	version: z.string().optional(),
	transport: z.object({ type: z.string() }).optional(),
	environmentVariables: z.array(Named).default([]),
	packageArguments: z
		.array(
			z.object({
				name: z.string().optional(),
				isRequired: z.boolean().optional(),
			}),
		)
		.default([]),
});
const RemoteSchema = z.object({
	type: z.string(),
	url: z.url(),
	headers: z.array(Named).default([]),
});

/** One server record of GET /v0.1/servers/<name>/versions/latest. */
export const OfficialServerSchema = z.object({
	server: z.object({
		name: z.string().min(1),
		version: z.string().min(1),
		packages: z.array(PackageSchema).default([]),
		remotes: z.array(RemoteSchema).default([]),
	}),
});
type Server = z.output<typeof OfficialServerSchema>["server"];
type Package = z.output<typeof PackageSchema>;

/** What `add` writes, and what the user still has to fill in by hand. */
export type Install = {
	readonly server: McpServer;
	readonly notes: readonly string[];
};

/** The mcp.yaml id of a registry name: its last segment, lowercased and kebab-cased. */
export const serverIdOf = (name: string) =>
	(name.split("/").pop() ?? name)
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");

const COMMANDS = {
	npm: {
		runtime: "node",
		command: "npx",
		args: (i: string, v: string) => ["-y", `${i}@${v}`],
	},
	pypi: {
		runtime: "python",
		command: "uvx",
		args: (i: string, v: string) => [`${i}==${v}`],
	},
} as const;
const runnable = (
	p: Package,
): p is Package & { registryType: keyof typeof COMMANDS } =>
	p.registryType in COMMANDS && (p.transport?.type ?? "stdio") === "stdio";

const missing = (p: Package) => [
	...p.environmentVariables
		.filter((e) => e.isRequired)
		.map((e) => `set the environment variable ${e.name} under env`),
	...p.packageArguments
		.filter((a) => a.isRequired)
		.map((a) => `add the required argument ${a.name ?? "(unnamed)"} to args`),
];

const fromPackage = (
	id: string,
	p: Package & { registryType: keyof typeof COMMANDS },
): Install | string => {
	if (!p.version || p.version === "latest")
		return `${p.identifier} names no pinned version, so it is not added`;
	const c = COMMANDS[p.registryType];
	const server = {
		id,
		transport: "stdio" as const,
		runtime: c.runtime,
		command: c.command,
		args: c.args(p.identifier, p.version),
		permissions: [],
	};
	return { server, notes: missing(p) };
};

const fromRemote = (
	id: string,
	r: z.output<typeof RemoteSchema>,
): Install | string => {
	if (r.type !== "streamable-http" && r.type !== "sse")
		return `its remote uses ${r.type}, which METE does not speak`;
	const transport =
		r.type === "sse" ? ("sse" as const) : ("streamable-http" as const);
	const server = {
		id,
		transport,
		url: r.url,
		auth: "none" as const,
		permissions: [],
	};
	const notes = r.headers
		.filter((h) => h.isRequired)
		.map((h) => `it needs the header ${h.name}, which mcp.yaml cannot set yet`);
	return { server, notes };
};

/** The entry to add, or why the server cannot be added automatically. */
export const installOf = (s: Server): Install | string => {
	const id = serverIdOf(s.name);
	const pkg = s.packages.find(runnable);
	if (pkg) return fromPackage(id, pkg);
	const remote = s.remotes[0];
	if (remote) return fromRemote(id, remote);
	return s.packages.length > 0
		? `its ${s.packages.map((p) => p.registryType).join(", ")} package is not added automatically; edit .mete/mcp.yaml by hand`
		: "it has no package or remote METE can run";
};
