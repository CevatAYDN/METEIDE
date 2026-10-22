import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// `mete mcp` speaks MCP on this process's stdin and stdout (docs/10, METE as an MCP server).

/** The stdio transport and a promise that settles when the host closes stdin. */
export const serveStdio = () => {
	// The SDK transport never closes on its own when stdin ends, so the host's exit is watched here.
	const closed = new Promise<void>((resolve) => {
		process.stdin.once("end", resolve);
		process.stdin.once("close", resolve);
	});
	return { transport: new StdioServerTransport(), closed };
};
