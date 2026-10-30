import type { KnowledgeHit, ToolContext } from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { SNIPPET_TOKENS } from "../defaults.js";
import type {
	Chunk,
	KeywordIndex,
	Query,
} from "../infrastructure/keyword-index.js";
import { cacheKey, type VectorIndex } from "../infrastructure/vector-index.js";
import { type EmbedJob, embedderOf, modelKey, NIL_RUN } from "./embed-job.js";

// The vector source of a search (docs/11, Hybrid search; ADR-152): the query is embedded once, under
// the caller's run id at priority 1, or the nil run id at priority 0 for a caller without a run, and
// only the stored vectors of the model that answered are searched. Any failure finds nothing, so the
// keyword source answers alone; quota_exhausted pauses the background job, never the caller's run.

/** What the vector source needs from its module. */
export type VectorDeps = {
	readonly registry: CapabilityRegistry;
	readonly index: KeywordIndex;
	readonly vectors: VectorIndex;
	readonly job: EmbedJob;
};

const embedQuery = async (deps: VectorDeps, text: string, ctx: ToolContext) => {
	const embedder = embedderOf(deps.registry);
	if (!embedder || !deps.vectors.latest()) return undefined;
	const runId = ctx.runId ?? NIL_RUN;
	const priority = ctx.runId ? 1 : 0;
	const req = { input: [text], purpose: "query", runId, priority } as const;
	const r = await embedder.embed(req, ctx.signal);
	if (r.ok) return r.value;
	if (r.error.code === "quota_exhausted")
		deps.job.pauseUntil(r.error.resumesAt);
	return undefined;
};

/** The sections nearest the query's meaning, nearest first, at most `k` before the filters. */
export const nearSections = async (
	deps: VectorDeps,
	q: Query & { readonly text: string },
	ctx: ToolContext,
): Promise<Chunk[]> => {
	const answer = await embedQuery(deps, q.text, ctx);
	const vector = answer?.vectors[0];
	if (!answer || !vector) return [];
	const model = modelKey(answer.model);
	// shortcut: the filters apply after the k nearest and every section is hashed again per search, fine for hundreds of notes; a filtered KNN and stored keys when code joins the index.
	const keys = deps.vectors.nearest(model, vector, q.k);
	const byKey = new Map<string, Chunk[]>();
	for (const c of deps.index.chunks(q)) {
		const key = cacheKey(c.body, model);
		byKey.set(key, [...(byKey.get(key) ?? []), c]);
	}
	return keys.flatMap((key) => byKey.get(key) ?? []);
};

/** A result only the vector source found: no rank yet (knowledge.search@2), the body's first words. */
export const vectorHit = (c: Chunk): KnowledgeHit => {
	const words = c.body.split(/\s+/).filter(Boolean);
	const cut = words.length > SNIPPET_TOKENS;
	return {
		path: c.path,
		scope: "workspace",
		type: c.type,
		title: c.title,
		...(c.heading ? { heading: c.heading } : {}),
		snippet: `${words.slice(0, SNIPPET_TOKENS).join(" ")}${cut ? "…" : ""}`,
		sources: {},
	};
};
