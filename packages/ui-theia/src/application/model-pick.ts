import type { ModelInfo, ProviderState } from "@mete/contracts";
import { modelRefOf } from "./composer.js";
import { tokenCount } from "./numbers.js";

// The model picker's list (ADR-161) as plain values, so the filter, the grouping and the keys are
// tested without Theia: the role's chain under a heading per provider, each model with its facts.
// The words are the picker's (model-picker.tsx); `free`, `tools` and `vision` stay as the ADR writes them.

/** A model row: its `providerId/modelId`, its id within the provider and its fact chips. */
export type PickModel = {
	readonly ref: string;
	readonly modelId: string;
	readonly chips: readonly string[];
};

/** A provider's heading, its state when it is not ready, and its models. */
export type PickGroup = {
	readonly providerId: string;
	readonly state?: ProviderState | undefined;
	readonly models: readonly PickModel[];
};

/** The rows below Let METE choose, and a typed full id the chain does not hold (ADR-077). */
export type PickList = {
	readonly groups: readonly PickGroup[];
	readonly use?: string | undefined;
};

const money = (m: ModelInfo) =>
	m.free ? "free" : m.price && `$${m.price.input} / $${m.price.output}`;

/** A model's facts as chips: free or its price, its context window, tools and vision when known. */
export const chipsOf = (m: ModelInfo | undefined): string[] =>
	m
		? [
				money(m),
				m.contextWindow > 0 && tokenCount(m.contextWindow),
				m.toolCalling === true && "tools",
				m.vision === true && "vision",
			].filter((c): c is string => typeof c === "string")
		: [];

const matches = (query: string, ref: string, family = "") => {
	const q = query.trim().toLowerCase();
	return q === "" || `${ref} ${family}`.toLowerCase().includes(q);
};

const notReady = (states: readonly ProviderState[], id: string) =>
	states.find((s) => s.id === id && s.state !== "ready");

/** The chain's models matching the query, grouped by provider in the order of its first model. */
export const pickList = (
	models: readonly string[],
	facts: readonly ModelInfo[],
	states: readonly ProviderState[],
	query: string,
): PickList => {
	const groups = new Map<string, PickModel[]>();
	for (const ref of models) {
		const r = modelRefOf(ref);
		const info = facts.find(
			(f) => f.providerId === r?.providerId && f.id === r?.modelId,
		);
		if (!r || !matches(query, ref, info?.family)) continue;
		const row = { ref, modelId: r.modelId, chips: chipsOf(info) };
		groups.set(r.providerId, [...(groups.get(r.providerId) ?? []), row]);
	}
	const typed = modelRefOf(query);
	const use = typed && `${typed.providerId}/${typed.modelId}`;
	return {
		groups: [...groups].map(([providerId, rows]) => ({
			providerId,
			state: notReady(states, providerId),
			models: rows,
		})),
		use: use && !models.includes(use) ? use : undefined,
	};
};

/** What each row picks, in the order of the list: null is Let METE choose. */
export const valuesOf = (list: PickList): (string | null)[] => [
	null,
	...list.groups.flatMap((g) => g.models.map((m) => m.ref)),
	...(list.use ? [list.use] : []),
];

/** The active row when the list opens: the chosen one, or after typing the first match, if any. */
export const startActive = (
	values: readonly (string | null)[],
	value: string,
	query: string,
): number | undefined => {
	if (query.trim() !== "") return values.length > 1 ? 1 : undefined;
	return Math.max(values.indexOf(value.trim() || null), 0);
};

const MOVE: Readonly<Record<string, (at: number, last: number) => number>> = {
	ArrowDown: (at, last) => Math.min(at + 1, last),
	ArrowUp: (at) => Math.max(at - 1, 0),
	Home: () => 0,
	End: (_, last) => last,
};

/** Where a key moves the active row of an open list, or undefined when the key does not move it. */
export const nextActive = (
	key: string,
	at: number | undefined,
	count: number,
): number | undefined => MOVE[key]?.(at ?? -1, count - 1);
