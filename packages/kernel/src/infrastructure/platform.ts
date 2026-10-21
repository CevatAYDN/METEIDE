import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { LOCK_RETRY_DELAYS_MS } from "../defaults.js";

// Platform rules from ARCHITECTURE.md (Data locations) and CONTRIBUTING.md (Cross-platform rules).

/** The global data folder: `%APPDATA%\METE`, `$XDG_DATA_HOME/mete` or `~/.local/share/mete`. */
export const globalDataDir = (
	env: Readonly<Record<string, string | undefined>>,
	platform: NodeJS.Platform,
	home: string,
): string => {
	if (platform === "win32")
		return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "METE");
	if (platform === "darwin")
		return join(home, "Library", "Application Support", "METE");
	return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "mete");
};

const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

const isLockError = (error: unknown) =>
	error instanceof Error &&
	"code" in error &&
	typeof error.code === "string" &&
	LOCK_CODES.has(error.code);

/** Runs a file operation, retrying Windows lock errors after 100, 300 and 1,000 ms. */
export const withLockRetry = async <T>(
	op: () => Promise<T>,
	platform: NodeJS.Platform = process.platform,
	sleep: (ms: number) => Promise<unknown> = setTimeout,
): Promise<T> => {
	for (const delay of LOCK_RETRY_DELAYS_MS) {
		try {
			return await op();
		} catch (error) {
			if (platform !== "win32" || !isLockError(error)) throw error;
			await sleep(delay);
		}
	}
	return op();
};
