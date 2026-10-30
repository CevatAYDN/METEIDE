import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

// `mete mcp` speaks MCP on this process's stdin and stdout (docs/10, METE as an MCP server).

/** The stdio transport and a promise that settles when the host closes stdin. */
export const serveStdio = () => {
	// The SDK transport closes itself when stdin ends, leaving calls in flight unanswered (ADR-163);
	// the host's exit is still watched here, so `mete mcp` stops its runs and exits.
	const closed = new Promise<void>((resolve) => {
		process.stdin.once("end", resolve);
		process.stdin.once("close", resolve);
	});
	return { transport: new StdioServerTransport(), closed };
};
