import type { Confirm } from "@mete/mcp";
import { ELICIT_TRIES } from "../defaults.js";
import type { Io } from "./commands.js";
import { yesNo } from "./elicit.js";

/**
 * The Confirm of a terminal (docs/10, MCP client, Sampling): METE's own yes or no question,
 * so it is not printed as something a server said. Without a terminal, or without a clear yes, it is no.
 */
export const terminalConfirm =
	(io: Io): Confirm =>
	async (_server, question) => {
		const read = io.readLine;
		if (!read) return false;
		for (let i = 0; i < ELICIT_TRIES; i++) {
			const line = await read(`${question} (y/n): `);
			if (line === undefined) return false;
			const answer = yesNo(line.trim());
			if (answer !== undefined) return answer;
		}
		return false;
	};
