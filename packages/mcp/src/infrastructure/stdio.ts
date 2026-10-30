// `mete mcp` speaks MCP on this process's stdin and stdout (docs/10, METE as an MCP server). The SDK
// loads here, not when a command starts (docs/15, CLI cold start).

/** The stdio transport and a promise that settles when the host closes stdin. */
export const serveStdio = async () => {
	const { StdioServerTransport } = await import(
		"@modelcontextprotocol/server/stdio"
	);
	// The SDK transport closes itself when stdin ends, leaving calls in flight unanswered (ADR-163);
	// the host's exit is still watched here, so `mete mcp` stops its runs and exits.
	const closed = new Promise<void>((resolve) => {
		process.stdin.once("end", resolve);
		process.stdin.once("close", resolve);
	});
	return { transport: new StdioServerTransport(), closed };
};
