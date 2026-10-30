import { RRF_K } from "../defaults.js";

// Reciprocal Rank Fusion of the keyword and vector sources (docs/11, Hybrid search; ADR-152): each id
// scores the sum of 1 / (RRF_K + its rank) over the sources that found it, ranks counted from 1.

const rankIn = (ids: readonly string[]) =>
	new Map(ids.map((id, i) => [id, i + 1] as const));

/** The ids best first, at most `k`; a tie goes to the better keyword rank, then the better vector rank. */
export const fuse = (
	keyword: readonly string[],
	vector: readonly string[],
	k: number,
): string[] => {
	const kw = rankIn(keyword);
	const vec = rankIn(vector);
	const score = (r: number | undefined) => (r ? 1 / (RRF_K + r) : 0);
	const scored = [...new Set([...keyword, ...vector])].map((id) => ({
		id,
		kw: kw.get(id) ?? Number.POSITIVE_INFINITY,
		vec: vec.get(id) ?? Number.POSITIVE_INFINITY,
		score: score(kw.get(id)) + score(vec.get(id)),
	}));
	return scored
		.sort((a, b) => b.score - a.score || a.kw - b.kw || a.vec - b.vec)
		.slice(0, k)
		.map((s) => s.id);
};
