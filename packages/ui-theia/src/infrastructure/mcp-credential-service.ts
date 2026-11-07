import {
	err,
	type McpCredentialWrite,
	McpCredentialWriteSchema,
	ok,
	type Result,
} from "@mete/contracts";
import type { DaemonFailure } from "../domain/status-service.js";
import type { RunCli } from "./spawn-cli.js";

/** Idle admission precedes the locked write-only CLI; its output is never reflected. */
export const createMcpCredentialService = (deps: {
	readonly run: RunCli;
	readonly restartIdle: (dir: string) => Promise<Result<null, DaemonFailure>>;
}) => ({
	set: async (
		dir: string,
		input: McpCredentialWrite,
	): Promise<Result<null, DaemonFailure>> => {
		const parsed = McpCredentialWriteSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "refused", detail: "Invalid MCP credential fields" });
		const idle = await deps.restartIdle(dir);
		if (!idle.ok) return idle;
		try {
			const result = await deps.run(
				["mcp-key", "set", dir],
				`${JSON.stringify(parsed.data)}\n`,
			);
			return result.code === 0
				? ok(null)
				: err({
						code: "cli",
						detail: "MCP credentials could not be saved; refresh and retry",
					});
		} catch {
			return err({
				code: "cli",
				detail: "MCP credential command could not finish",
			});
		}
	},
});
