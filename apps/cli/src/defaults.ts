// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Tab 06, capability catalog (default adapters in fallback order): built-in bindings the user's replace. */
export const BUILT_IN_BINDINGS = {
	"web.search@1": ["exa-mcp", "tavily"],
	"registry.search@1": ["official-mcp-registry", "local-registry"],
} as const;

/** Tab 10, MCP client (Elicitation): how many times the terminal asks one field before it declines the request. */
export const ELICIT_TRIES = 2;
