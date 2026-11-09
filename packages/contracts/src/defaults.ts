// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).
import type { Tier } from "./domain/llm.js";

/** Built-in policy: the example `.mete/policy.yaml` (12 Autonomy and security). */
export const DEFAULT_POLICY = {
	autonomy: 2,
	overrides: { "shell.exec@1": 1 },
	always_ask: [
		"fs.delete",
		"git.push",
		"git.merge",
		"plugin.install",
		"mcp.install",
		"mcp.sampling",
		"release.publish",
		"vault.write.personal",
	],
	never_allow: [
		{ action: "fs.write", path: "~/.ssh/**" },
		{ action: "shell.exec", command: "rm -rf /*" },
		// Ending programs the agent did not start (ADR-063).
		{ action: "shell.exec", command: "*taskkill*" },
		{ action: "shell.exec", command: "*tskill*" },
		{ action: "shell.exec", command: "*Stop-Process*" },
		{ action: "shell.exec", command: "spps *" },
		{ action: "shell.exec", command: "kill *" },
		{ action: "shell.exec", command: "pkill *" },
		{ action: "shell.exec", command: "killall *" },
		{ action: "shell.exec", command: "*.Kill*" },
	],
	shellAllow: ["pnpm *", "npm test", "npm run *", "git status", "git diff *"],
	// Exact commands the user allowed for good with Always allow (ADR-121); none built in.
	shellAlways: [],
	cloudRequestsPerRun: 150,
	maxHours: 6,
	approvalTimeoutHours: 24,
} as const;

/** Team template values when a key is left out (08 Orchestration and teams, Team template schema). */
export const TEMPLATE_DEFAULTS = {
	engine: "native",
	revisionLimit: 3,
	guardrailMaxRetries: 2,
	reviewMaxTurns: 4,
	cloudRequests: 150,
	maxHours: 6,
	retrospective: false,
} as const;

/** Results web.search@1 returns when the caller names no maxResults (10 Tools, MCP and runtimes). */
export const WEB_SEARCH_MAX_RESULTS = 8;

/** Tab 09, Model tiers: minimum context window per tier, "k" read as 1000 tokens. */
export const TIER_MIN_CONTEXT: Readonly<Record<Tier, number>> = {
	reasoning: 32_000,
	coder: 32_000,
	fast: 8_000,
	"long-context": 128_000,
	vision: 32_000, // ADR-060: also the window compaction counts against
};

/** Tab 09, Gateway: the quota estimate counts this many prompt characters as one token. */
export const CHARS_PER_TOKEN = 4;

/** Tab 09, Gateway (ADR-042): the daily spending cap over paid models, in US dollars. */
export const DAILY_SPEND_USD = 1;

/** ADR-182: default and maximum summaries in one conversation history page. */
export const THREAD_LIST_LIMIT = 50;
export const THREAD_LIST_MAX = 100;

/** ADR-183: explicit editor-context count and UTF-8 byte limits. */
export const CONTEXT_ATTACHMENT_COUNT = 4;
export const CONTEXT_ATTACHMENT_BYTES = 32 * 1024;
export const CONTEXT_TOTAL_BYTES = 64 * 1024;
/** ADR-183: maximum input source-path characters. */
export const CONTEXT_PATH_CHARS = 4096;

/** ADR-184: bounded write-only MCP field count and per-value characters. */
export const MCP_CREDENTIAL_FIELDS_MAX = 32;
export const MCP_CREDENTIAL_VALUE_CHARS = 4096;

/** ADR-189 skill-runtime design: public S1 bounds; candidates = two 256-entry roots. */
export const SKILL_LIMITS = {
	fileBytes: 65_536,
	nameChars: 64,
	descriptionChars: 1024,
	optionalTextChars: 500,
	metadataPairs: 32,
	metadataValueChars: 1024,
	catalogEntries: 128,
	sourceCandidates: 256 * 2,
} as const;

/** ADR-190 accepted skill-activation-design.md: S2 catalog and per-context UTF-8 budgets. */
export const SKILL_RUNTIME_LIMITS = {
	catalogBytes: 16_384,
	perContext: 4,
	totalBytes: 65_536,
} as const;
