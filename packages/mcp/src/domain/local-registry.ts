import {
	type RegistryEntry,
	RegistryEntrySchema,
	type RegistrySearchInput,
} from "@mete/contracts";
import { z } from "zod";

// The catalogue file of a local registry (docs/10, Registries): `registry/index.json` in the global
// folder. The METE registry repository serves a file of the same shape, so one reader fits both.

const key = (e: RegistryEntry) => `${e.kind}:${e.id}`;

/** `{entries}`: each entry is one id at one version, so a kind and an id appear once. */
export const LocalIndexSchema = z
	.strictObject({ entries: z.array(RegistryEntrySchema) })
	.refine(
		({ entries }) => new Set(entries.map(key)).size === entries.length,
		"a kind and an id may appear only once",
	);

/** The entries whose id or description holds every word of the query (any case), of the kind asked for. */
export const matching = (
	entries: readonly RegistryEntry[],
	{ query, kind }: RegistrySearchInput,
) => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return entries.filter((e) => {
		if (kind && e.kind !== kind) return false;
		const text = `${e.id} ${e.description}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
};
