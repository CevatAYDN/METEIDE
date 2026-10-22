import { z } from "zod";
import { PermissionSchema } from "./manifest.js";
import type { ToolAdapter } from "./tools.js";

// registry.search@1 from docs/10 (Registries): installable entries, never installed by the search.

const RegistryKindSchema = z.enum([
	"mcp",
	"plugin",
	"skill",
	"template",
	"mapping",
]);

/** Input of registry.search@1: words to match and, optionally, one kind of entry. */
export const RegistrySearchInputSchema = z.strictObject({
	query: z.string().trim().min(1),
	kind: RegistryKindSchema.optional(),
});
export type RegistrySearchInput = z.input<typeof RegistrySearchInputSchema>;

/**
 * One entry, its newest version only. `source` is where it comes from (`npm:<package>`,
 * `pypi:<package>`, `oci:<image>`, a download URL, or the URL of a remote server); `sha256` is
 * there only when the registry gives one, and `permissions` may be empty when it names none.
 */
export const RegistryEntrySchema = z.strictObject({
	id: z.string().min(1),
	kind: RegistryKindSchema,
	version: z.string().min(1),
	description: z.string(),
	source: z.string().min(1),
	runtime: z.enum(["node", "python", "binary", "container", "remote"]),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.optional(),
	permissions: z.array(PermissionSchema).readonly(),
});
export type RegistryEntry = z.output<typeof RegistryEntrySchema>;

export type RegistrySearchOutput = {
	readonly entries: readonly RegistryEntry[];
};

/** registry.search@1; asks policy.check@1 with action net.fetch before it reads a remote registry. */
export type RegistrySearchAdapter = ToolAdapter<
	RegistrySearchInput,
	RegistrySearchOutput
>;
