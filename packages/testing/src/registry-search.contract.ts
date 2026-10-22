import {
	type RegistryEntry,
	RegistryEntrySchema,
	type RegistrySearchAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for registry.search@1 (docs/10 Registries). `mete registry search` walks the adapters
// in order, so each must answer the same way. Whether an adapter asks policy.check@1 depends on
// whether it reaches the network, so the policy answers are tested with each adapter, not here.

/**
 * What the registry holds for the test: an `mcp` server run with npm, the entries below (at most as
 * many as the request limit lets through, as a real registry does), or nothing reachable.
 */
export type RegistryWorld =
	| { readonly entries: readonly RegistryEntry[] }
	| "down";

/** Opens the adapter on a registry that holds `world`. */
export type RegistryHarness = (world: RegistryWorld) => Promise<{
	readonly adapter: RegistrySearchAdapter;
	readonly close: () => Promise<void>;
}>;

const ctx = { signal: new AbortController().signal };
// docs/10: a search answers at most 20 entries.
const LIMIT = 20;

/** An npm-run `mcp` entry named `files-<n>`, the one shape every adapter can hold. */
const registryEntry = (n: number): RegistryEntry => ({
	id: `files-${n}`,
	kind: "mcp",
	version: `1.0.${n}`,
	description: `Files on disk, number ${n}`,
	source: `npm:files-${n}`,
	runtime: "node",
	permissions: [],
});

/** Every registry.search@1 adapter MUST pass these tests. */
export const registrySearchContract = (name: string, open: RegistryHarness) =>
	describe(`registry.search@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const search = async (
			input: { query: string; kind?: RegistryEntry["kind"] },
			world: RegistryWorld,
		) => {
			const h = await open(world);
			close = h.close;
			return h.adapter.run(input, ctx);
		};
		const held = Array.from({ length: 3 }, (_, i) => registryEntry(i));

		it("returns the entries that match, as entries of the contract", async () => {
			const r = await search({ query: "files-1" }, { entries: held });
			expect(r.ok && r.value.entries).toEqual([registryEntry(1)]);
			for (const e of r.ok ? r.value.entries : [])
				expect(RegistryEntrySchema.safeParse(e).success).toBe(true);
		});

		it("returns nothing when nothing matches, or when the kind is another one", async () => {
			const none = await search({ query: "no-such-server" }, { entries: held });
			expect(none.ok && none.value.entries).toEqual([]);
			await close?.();
			const kind = await search(
				{ query: "files", kind: "template" },
				{ entries: held },
			);
			expect(kind.ok && kind.value.entries).toEqual([]);
		});

		it("answers at most 20 entries", async () => {
			const many = Array.from({ length: LIMIT + 5 }, (_, i) =>
				registryEntry(i),
			);
			const r = await search({ query: "files" }, { entries: many });
			expect(r.ok && r.value.entries).toHaveLength(LIMIT);
		});

		it("answers io when the registry cannot be read", async () => {
			const r = await search({ query: "files" }, "down");
			expect(r.ok === false && r.error.code).toBe("io");
		});

		it("refuses an empty query as bad_input", async () => {
			const r = await search({ query: "  " }, { entries: held });
			expect(r.ok === false && r.error.code).toBe("bad_input");
		});
	});
