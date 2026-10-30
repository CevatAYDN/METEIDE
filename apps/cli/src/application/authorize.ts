import type { Authorize } from "@mete/mcp";
import type { Io } from "./commands.js";

/**
 * The Authorize of a terminal (docs/10, MCP client, Authentication): METE prints the address to open,
 * the user opens it in their own browser, and pastes back the address it ends up on. METE opens no
 * browser. Without a terminal it asks nothing and prints nothing, so `mete mcp` stays quiet. It says
 * why the last address was refused, and that the server's tools are left out when the input ends.
 */
export const terminalAuthorize =
	(io: Io): Authorize =>
	async (server, url, _signal, refused) => {
		const read = io.readLine;
		if (!read) return undefined;
		if (refused) io.out(`The last address was refused: ${refused}`);
		io.out(`MCP server ${server} needs you to sign in:`);
		io.out(`  ${url}`);
		io.out(
			"Open it, allow access, then paste the address your browser ends up on (it shows a connection error).",
		);
		const pasted = await read("Address: ");
		if (pasted === undefined)
			io.out(
				`Not signed in: MCP server ${server}'s tools are left out of this command.`,
			);
		return pasted;
	};
