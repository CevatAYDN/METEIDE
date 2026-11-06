import type { SecretsMaskAdapter } from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import type { Progress } from "@modelcontextprotocol/client";
import { PROGRESS_EVERY_MS } from "../defaults.js";

/** Publishes the first progress step at once, then at most once per interval (ADR-067). */
export const progressThrottle = (now: () => number) => {
	let last = Number.NEGATIVE_INFINITY;
	return () => {
		const at = now();
		if (at - last < PROGRESS_EVERY_MS) return false;
		last = at;
		return true;
	};
};

/** Keeps progress diagnostics out of events and masks free text before global logging (ADR-067). */
export const logProgress = async (
	deps: { readonly logger: Logger; readonly mask?: SecretsMaskAdapter },
	fields: Readonly<Record<string, unknown>>,
	progress: Progress,
): Promise<void> => {
	let message: string | undefined;
	if (progress.message && deps.mask) {
		try {
			message = (await deps.mask.mask(progress.message)).text;
		} catch {
			deps.logger.warn(fields, "MCP progress message could not be masked");
		}
	}
	deps.logger.info(
		{
			...fields,
			progress: progress.progress,
			...(progress.total === undefined ? {} : { total: progress.total }),
			...(message === undefined ? {} : { message }),
		},
		"MCP tool progress",
	);
};
