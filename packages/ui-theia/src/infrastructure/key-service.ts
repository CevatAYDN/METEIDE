import { err, ok, type Result } from "@mete/contracts";
import { type ProviderKey, parseKeyList } from "../domain/provider-keys.js";
import type { DaemonFailure } from "../domain/status-service.js";
import type { CliResult, RunCli } from "./spawn-cli.js";

// Provider keys through `mete key` (ADR-049): the store is the one the CLI and the daemon read, and
// the key travels on standard input only. A daemon reads keys when it starts, so it restarts.

/** What the key service runs: a `mete` command, and the restart of the folder's daemon. */
export type KeyDeps = {
	readonly run: RunCli;
	readonly restart: () => Promise<void>;
};

const failed = (r: CliResult): Result<never, DaemonFailure> =>
	err({
		code: "refused",
		detail: (r.stderr || r.stdout).trim() || `exit code ${r.code}`,
	});

/** Lists and sets provider keys. */
export const createKeyService = (deps: KeyDeps) => ({
	keys: async (): Promise<Result<ProviderKey[], DaemonFailure>> => {
		const r = await deps.run(["key", "list"]);
		if (r.code !== 0) return failed(r);
		const keys = parseKeyList(r.stdout);
		return keys
			? ok(keys)
			: err({
					code: "protocol",
					detail: `mete key list printed: ${r.stdout.trim()}`,
				});
	},
	setKey: async (
		providerId: string,
		key: string,
	): Promise<Result<null, DaemonFailure>> => {
		const r = await deps.run(["key", "set", providerId], `${key}\n`);
		if (r.code !== 0) return failed(r);
		await deps.restart();
		return ok(null);
	},
});
