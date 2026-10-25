// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Tab 06, capability catalog (default adapters in fallback order): built-in bindings the user's replace. */
export const BUILT_IN_BINDINGS = {
	"web.search@1": ["exa-mcp", "tavily"],
	"registry.search@1": ["official-mcp-registry", "local-registry"],
} as const;

/** Tab 10, MCP client (Elicitation): how many times the terminal asks one field before it declines the request. */
export const ELICIT_TRIES = 2;

/** Audit rows `mete audit` and mete/audit show at most, newest first (04 Decisions, ADR-053). */
export const AUDIT_LIMIT = 200;

/** The one user message of a custom endpoint's Test probe (04 Decisions, ADR-087). */
export const PROBE_PROMPT = "ping";

/** The most tokens a Test probe asks for (04 Decisions, ADR-087). */
export const PROBE_MAX_TOKENS = 16;

/** How long one Test probe may take before it is aborted (04 Decisions, ADR-087). */
export const PROBE_TIMEOUT_MS = 30_000;

/** How long one `mete/changes` read of the working tree may take before it is aborted (04 Decisions, ADR-100). */
export const CHANGES_TIMEOUT_MS = 15_000;

/** The most tokens a member draft asks its model for (04 Decisions, ADR-108). */
export const DRAFT_MAX_TOKENS = 700;

/** How long a whole member draft — the web search and the one model call — may take (04 Decisions, ADR-108). */
export const DRAFT_TIMEOUT_MS = 90_000;

/** How many web results a member draft reads (04 Decisions, ADR-108). */
export const DRAFT_SEARCH_RESULTS = 5;
