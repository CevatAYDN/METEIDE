// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).
import type { McpServer } from "@mete/contracts";

/** Tab 10, MCP client: characters of a server's stderr kept for its error messages. */
export const STDERR_TAIL_CHARS = 2000;

/** Tab 10, MCP client: servers every workspace has; an mcp.yaml entry with the same id replaces one. */
export const BUILT_IN_SERVERS: readonly McpServer[] = [
	{
		id: "exa",
		transport: "streamable-http",
		url: "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa",
		auth: "none",
		permissions: [],
	},
];

/** Tab 10, Managed runtimes: a system Node.js of this major version or newer is used as it is. */
export const NODE_MIN_MAJOR = 20;

/** Tab 10, Managed runtimes: how long downloading and extracting one runtime may take. */
export const RUNTIME_INSTALL_TIMEOUT_MS = 600_000;

/** One pinned archive: the official release URL, its SHA-256 and the folder inside it that holds the commands. */
export type PinnedAsset = {
	readonly url: string;
	readonly sha256: string;
	readonly bin: string;
};

const NODE = "https://nodejs.org/dist/v24.21.0/node-v24.21.0";
const UV =
	"https://github.com/astral-sh/uv/releases/download/0.12.23/uv-x86_64";

/**
 * Tab 10, Managed runtimes: Node.js 24.21.0 LTS (2026-09-07, hashes from its SHASUMS256.txt) and
 * uv 0.12.23 (2026-10-03, hashes from each asset's .sha256), both at least 14 days old (tab 05).
 */
export const RUNTIME_PINS = {
	node: {
		dir: "node",
		version: "24.21.0",
		assets: {
			"win32-x64": {
				url: `${NODE}-win-x64.zip`,
				sha256:
					"158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
				bin: "node-v24.21.0-win-x64",
			},
			"linux-x64": {
				url: `${NODE}-linux-x64.tar.gz`,
				sha256:
					"6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff",
				bin: "node-v24.21.0-linux-x64/bin",
			},
		},
	},
	python: {
		dir: "uv",
		version: "0.12.23",
		assets: {
			"win32-x64": {
				url: `${UV}-pc-windows-msvc.zip`,
				sha256:
					"75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90",
				bin: "",
			},
			"linux-x64": {
				url: `${UV}-unknown-linux-gnu.tar.gz`,
				sha256:
					"9167d72b3319674b6303c4cbe071854bba13ebdf3d76b1a7cbdc175471fb66d6",
				bin: "uv-x86_64-unknown-linux-gnu",
			},
		},
	},
} as const satisfies Record<
	"node" | "python",
	{ dir: string; version: string; assets: Record<string, PinnedAsset> }
>;

/** Tab 10, Registries: the official MCP registry's server list. */
export const OFFICIAL_REGISTRY_URL =
	"https://registry.modelcontextprotocol.io/v0.1/servers";

/** Tab 10, Registries: entries one search asks the official registry for. */
export const REGISTRY_SEARCH_LIMIT = 20;

/** Tab 10, Registries: how long one registry search may take. */
export const REGISTRY_TIMEOUT_MS = 30_000;

/** Tab 10, MCP client (Sampling): a model-preference priority from this value up counts as high. */
export const SAMPLING_PRIORITY_HIGH = 0.7;

/** Tab 09, quota (priority classes): sampling runs inside a foreground run, so class P1. */
export const SAMPLING_PRIORITY = 1;

/** Tab 10, MCP client (ADR-067): a call publishes a progress step at most this often. */
export const PROGRESS_EVERY_MS = 1_000;
