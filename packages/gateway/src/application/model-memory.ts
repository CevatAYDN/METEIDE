import type { ProviderError } from "@mete/contracts";
import { DEMOTE_AFTER } from "../defaults.js";
import {
	type Discovered,
	type PrivacyRules,
	privacyBlocked,
} from "../domain/resolve.js";
import { isStall } from "./stall.js";

// What the gateway remembers between calls about models that did not answer (docs/09, Gateway,
// Retries in detail): a refused key leaves a model out, a rejected request is only logged.

/**
 * The models left out, the models whose rejection of a request was logged already, how many calls
 * in a row each model failed, and the providers whose privacy exclusion was logged already.
 */
export type Memory = {
	readonly refused: Set<string>;
	readonly reported: Set<string>;
	readonly strikes: Map<string, number>;
	readonly blocked: Set<string>;
};

export const newMemory = (): Memory => ({
	refused: new Set(),
	reported: new Set(),
	strikes: new Map(),
	blocked: new Set(),
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

/**
 * A model failed a call. A stall costs the call its whole wait, so it strikes the model out at once
 * (ADR-131); a rate limit is the quota's business, not the model's.
 */
export const blame = (memory: Memory, key: string, e: ProviderError) => {
	const had = memory.strikes.get(key) ?? 0;
	if (isStall(e)) memory.strikes.set(key, Math.max(had, DEMOTE_AFTER));
	else if (e.code !== "rate_limited") memory.strikes.set(key, had + 1);
};

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
		"model refused the key or is not served; left out until the gateway restarts",
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

/**
 * A provider whose models the privacy rules all leave out would otherwise never be used, with no word
 * why: the user added its key, so it is logged once per provider and process.
 */
export const noteBlocked = (
	warn: Warn,
	memory: Memory,
	found: readonly Discovered[],
	rules: PrivacyRules,
) => {
	for (const providerId of privacyBlocked(found, rules)) {
		if (memory.blocked.has(providerId)) continue;
		memory.blocked.add(providerId);
		warn(
			{ providerId },
			"every model of this provider is left out by the privacy rules; allowTraining: true in privacy.yaml admits those that train, never in a sensitive workspace",
		);
	}
};
