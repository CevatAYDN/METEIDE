// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Tab 06, capability catalog (default adapters in fallback order): built-in bindings the user's replace. */
export const BUILT_IN_BINDINGS = {
	"web.search@1": ["exa-mcp", "tavily"],
	"registry.search@1": ["official-mcp-registry", "local-registry"],
} as const;

/** Tab 15, LLM replay (ADR-111): the env var a chat script's path comes from; unset outside the desktop's end-to-end tests. */
export const SCRIPTED_CHAT_ENV = "METE_SCRIPTED_CHAT";

/** Tab 15, LLM replay (ADR-116): the env var a web script's path comes from; unset outside the desktop's end-to-end tests. */
export const SCRIPTED_WEB_ENV = "METE_SCRIPTED_WEB";

/** Tab 15, LLM replay (ADR-117): the env var a browser script's path comes from; unset outside the desktop's end-to-end tests. */
export const SCRIPTED_BROWSER_ENV = "METE_SCRIPTED_BROWSER";

/** Tab 15, builds (ADR-115): the folders a packaged desktop ships beside the app; unset in development, where the repository's folders are used. */
export const TEMPLATES_DIR_ENV = "METE_TEMPLATES_DIR";

/** Tab 15, builds (ADR-115): the level 2 mapping files of a packaged desktop; unset in development. */
export const ADAPTERS_DIR_ENV = "METE_ADAPTERS_DIR";

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
