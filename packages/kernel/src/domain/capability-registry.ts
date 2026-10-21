import {
	type CapabilityRef,
	err,
	type ModuleManifest,
	ok,
	type Result,
} from "@mete/contracts";
import type { Disposable } from "./event-bus.js";

// Capability registry from docs/06-kernel-and-modules.md (Kernel API, Capability resolution).

/** Feature names an adapter supports or a caller needs; order and duplicates do not matter. */
export type FeatureSet = ReadonlyArray<string>;

/** Whether an adapter's calls are failing; read at resolve time. */
export type Circuit = { readonly isOpen: () => boolean };

/** One implementation of a capability, provided by an active module. */
export type Adapter<C> = {
	readonly id: string;
	readonly trust: ModuleManifest["trust"];
	readonly features: FeatureSet;
	readonly impl: C;
	readonly circuit?: Circuit;
};

/** Adapters in fallback order; the caller moves to the next on `AdapterUnavailable`. */
export type AdapterChain<C> = readonly [Adapter<C>, ...Adapter<C>[]];

/** No active adapter serves the capability with the needed features. */
export type CapabilityMissing = {
	readonly code: "capability_missing";
	readonly ref: CapabilityRef;
};

/** An adapter cannot serve this call; the caller tries the next one in the chain. */
export type AdapterUnavailable = {
	readonly code: "adapter_unavailable";
	readonly adapterId: string;
};

/** Reads the workspace binding of a capability: adapter ids in fallback order. */
export type BindingReader = (ref: CapabilityRef) => ReadonlyArray<string>;

/** Finds the adapters that serve a capability. */
export interface CapabilityRegistry {
	provide<C>(ref: CapabilityRef, adapter: Adapter<C>): Disposable;
	resolve<C>(
		ref: CapabilityRef,
		need?: FeatureSet,
	): Result<AdapterChain<C>, CapabilityMissing>;
	has(ref: CapabilityRef): boolean;
}

const TRUST_ORDER = { core: 0, "first-party": 1, "third-party": 2 } as const;

// Bound adapters take their binding position; the rest follow by trust. The sort is stable,
// so equal ranks keep registration order.
const rank = (binding: ReadonlyArray<string>, a: Adapter<unknown>): number => {
	const i = binding.indexOf(a.id);
	return i >= 0 ? i : binding.length + TRUST_ORDER[a.trust];
};

/** Creates an empty registry; `bindings` comes from the workspace configuration. */
export const createCapabilityRegistry = (
	bindings: BindingReader,
): CapabilityRegistry => {
	const adapters = new Map<CapabilityRef, ReadonlyArray<Adapter<unknown>>>();
	const list = (ref: CapabilityRef) => adapters.get(ref) ?? [];
	return {
		provide(ref, adapter) {
			if (list(ref).some((a) => a.id === adapter.id))
				throw new Error(`adapter ${adapter.id} already provides ${ref}`);
			adapters.set(ref, [...list(ref), adapter]);
			return {
				dispose: () =>
					adapters.set(
						ref,
						list(ref).filter((a) => a !== adapter),
					),
			};
		},
		resolve<C>(ref: CapabilityRef, need: FeatureSet = []) {
			const binding = bindings(ref);
			const [first, ...rest] = list(ref)
				.filter((a) => !a.circuit?.isOpen())
				.filter((a) => need.every((f) => a.features.includes(f)))
				.toSorted((a, b) => rank(binding, a) - rank(binding, b));
			if (!first) return err({ code: "capability_missing", ref });
			return ok([first, ...rest] as AdapterChain<C>);
		},
		has: (ref) => list(ref).length > 0,
	};
};
