import type { ProviderError } from "@mete/contracts";

// What the gateway remembers between calls about models that did not answer (docs/09, Gateway,
// Retries in detail): a refused key leaves a model out, a rejected request is only logged.

/** The models left out, and the models whose rejection of a request was logged already. */
export type Memory = {
	readonly refused: Set<string>;
	readonly reported: Set<string>;
};

export const newMemory = (): Memory => ({
	refused: new Set(),
	reported: new Set(),
});

/** A model as the log names it: its key in the sets and the fields of its log line. */
export type Who = {
	readonly key: string;
	readonly fields: Readonly<Record<string, unknown>>;
};

export type Warn = (
	fields: Readonly<Record<string, unknown>>,
	msg: string,
) => void;

const why = (e: ProviderError) => ({
	code: e.code,
	status: e.status,
	reason: e.message,
});

// shortcut: a refused model stays out until the gateway restarts, so a new key needs a new process.
/** Leaves the model out of every later call and logs why. */
export const refuse = (
	warn: Warn,
	memory: Memory,
	who: Who,
	e: ProviderError,
) => {
	memory.refused.add(who.key);
	warn(
		{ ...who.fields, ...why(e) },
		"model refused the key; left out until the gateway restarts",
	);
};

/**
 * A rejected request is tried again on the next call, and each try costs a request on the provider's
 * quota, so the status and message that say why are logged once per model and process.
 */
export const report = (
	warn: Warn,
	memory: Memory,
	who: Who,
	e: ProviderError,
) => {
	if (memory.reported.has(who.key)) return;
	memory.reported.add(who.key);
	warn(
		{ ...who.fields, ...why(e) },
		"model rejected the request; it is tried again on the next call",
	);
};
