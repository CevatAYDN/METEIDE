import { join } from "node:path";
import type { Logger } from "@mete/kernel";
import { pino } from "pino";

// Logs are pino JSON lines in the global logs/ folder, one file per day (ARCHITECTURE.md, CLI).

/** A logger that writes to logs/mete-<YYYY-MM-DD>.log under the global data folder. */
export const fileLogger = (globalDir: string, now = Date.now()): Logger => {
	const day = new Date(now).toISOString().slice(0, 10);
	const dest = join(globalDir, "logs", `mete-${day}.log`);
	// sync: the CLI exits soon after its last line, and nothing may be lost then.
	const log = pino(pino.destination({ dest, mkdir: true, sync: true }));
	return {
		error: (fields, msg) => log.error(fields, msg),
		warn: (fields, msg) => log.warn(fields, msg),
		info: (fields, msg) => log.info(fields, msg),
		debug: (fields, msg) => log.debug(fields, msg),
	};
};

/** The same logger with the module id on every line. */
export const moduleLogger = (base: Logger, module: string): Logger => ({
	error: (fields, msg) => base.error({ module, ...fields }, msg),
	warn: (fields, msg) => base.warn({ module, ...fields }, msg),
	info: (fields, msg) => base.info({ module, ...fields }, msg),
	debug: (fields, msg) => base.debug({ module, ...fields }, msg),
});
