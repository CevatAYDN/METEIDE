import type { ProviderError } from "@mete/contracts";
import { DEMOTE_AFTER } from "../defaults.js";

// What the gateway remembers between calls about models that did not answer (docs/09, Gateway,
// Retries in detail): a refused key leaves a model out, a rejected request is only logged.

/**
 * The models left out, the models whose rejection of a request was logged already, and how many
 * calls in a row each model failed.
 */
export type Memory = {
	readonly refused: Set<string>;
	readonly reported: Set<string>;
	readonly strikes: Map<string, number>;
};

export const newMemory = (): Memory => ({
	refused: new Set(),
	reported: new Set(),
	strikes: new Map(),
});

const struck = (memory: Memory, key: string) =>
	(memory.strikes.get(key) ?? 0) >= DEMOTE_AFTER;

/** The chain with the models that keep failing moved to its end, each group in its own order. */
export const demoted = <T>(
	chain: readonly T[],
	memory: Memory,
	keyOf: (item: T) => string,
): T[] => [
	...chain.filter((o) => !struck(memory, keyOf(o))),
	...chain.filter((o) => struck(memory, keyOf(o))),
];

/** A model failed a call (a rate limit is the quota's business, not the model's). */
export const strike = (memory: Memory, key: string) =>
	memory.strikes.set(key, (memory.strikes.get(key) ?? 0) + 1);

/** A model answered: it is back in its place. */
export const forgive = (memory: Memory, key: string) =>
	memory.strikes.delete(key);

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
