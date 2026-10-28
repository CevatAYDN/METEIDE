import { z } from "zod";
import type { VaultScope } from "./vault.js";

// knowledge.search@1 from docs/11 (Hybrid search) and ADR-149; adapters return ToolError (tools.ts).

const text = z.string().trim().min(1);

/** The note types of docs/11's frontmatter; agents write all but inbox (vault.ts). */
export const NoteTypeSchema = z.enum([
	"decision",
	"lesson",
	"entity",
	"journal",
	"inbox",
]);
export type NoteType = z.infer<typeof NoteTypeSchema>;

/** Input of knowledge.search@1; scope all and k 8 are docs/11's defaults. */
export const KnowledgeSearchInputSchema = z.strictObject({
	query: text,
	scope: z.enum(["workspace", "personal", "all"]).default("all"),
	k: z.number().int().min(1).max(30).default(8),
	type: NoteTypeSchema.optional(),
	path: text.optional(),
});
export type KnowledgeSearchInput = z.input<typeof KnowledgeSearchInputSchema>;

/** One note section found; `sources` holds its 1-based rank in each source that found it. */
export type KnowledgeHit = {
	readonly path: string;
	readonly scope: VaultScope;
	readonly type: NoteType;
	readonly title: string;
	readonly heading?: string;
	readonly snippet: string;
	readonly sources: { readonly keyword?: number };
};
/** Best first, at most k. */
export type KnowledgeSearchOutput = {
	readonly results: readonly KnowledgeHit[];
};
