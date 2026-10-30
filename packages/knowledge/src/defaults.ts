// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** New lesson, entity and decision notes one run may write (11 Knowledge layer, Writing rules). */
export const NEW_NOTES_PER_RUN = 3;

/** Characters a note's file name keeps of its title (11 Knowledge layer, Vaults; ADR-145). */
export const SLUG_MAX = 60;

/** Characters of one row of the keyword index: 1,000 tokens at 4 characters each (11 Knowledge layer, Indexing; ADR-149). */
export const CHUNK_CHARS = 4000;

/** Tokens of a search result's snippet (11 Knowledge layer, Hybrid search; ADR-149). */
export const SNIPPET_TOKENS = 40;

/** The k of Reciprocal Rank Fusion that joins the keyword and vector ranks (11 Knowledge layer, Hybrid search; ADR-152). */
export const RRF_K = 60;

/** Sections one embedding request sends (11 Knowledge layer, Indexing; ADR-152). */
export const EMBED_BATCH = 32;
