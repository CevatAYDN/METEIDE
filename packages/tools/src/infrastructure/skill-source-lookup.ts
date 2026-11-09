import {
	err,
	type SkillSourceDescriptor,
	SkillSourceInputSchema,
} from "@mete/contracts";
import { listSkillSources, resolveSkillLocation } from "./skill-enumeration.js";
import { type SkillRoots, skillLocation, skillRoot } from "./skill-location.js";

type Hint = Pick<SkillSourceDescriptor, "scope" | "path">;
type Lookup = { hints: Map<string, Hint>; revision: number };

const refresh = async (
	opts: SkillRoots,
	state: Lookup,
	signal: AbortSignal,
) => {
	const revision = ++state.revision;
	state.hints.clear();
	const listed = await listSkillSources(opts, signal);
	if (signal.aborted) return err({ code: "aborted" as const });
	if (revision === state.revision && listed.ok && listed.value.complete) {
		for (const { sourceId, scope, path } of listed.value.sources)
			state.hints.set(sourceId, { scope, path });
	}
	return listed;
};

const currentHint = async (
	opts: SkillRoots,
	source: SkillSourceDescriptor,
	signal: AbortSignal,
) => {
	const root = await skillRoot(opts, source.scope, signal);
	if (!root.ok) return root;
	const name = source.path.slice(0, -"/SKILL.md".length);
	const location = await skillLocation(root.value, name, signal);
	if (!location.ok) return location;
	if (location.value.source.sourceId !== source.sourceId)
		return err({ code: "not_found" as const });
	const current = await skillRoot(opts, source.scope, signal);
	if (!current.ok) return current;
	if (
		JSON.stringify(root.value.identity) !==
		JSON.stringify(current.value.identity)
	)
		return err({ code: "stale" as const, location: "root" as const });
	return location;
};

/** Bounded descriptor hints only; no cached identity, metadata, eligibility or bytes. */
export const createSkillSourceLookup = (opts: SkillRoots) => {
	const state: Lookup = { hints: new Map(), revision: 0 };
	return {
		list: (signal: AbortSignal) => refresh(opts, state, signal),
		async locate(input: unknown, signal: AbortSignal) {
			if (signal.aborted) return err({ code: "aborted" as const });
			const parsed = SkillSourceInputSchema.safeParse(input);
			if (!parsed.success) return err({ code: "bad_input" as const });
			const { sourceId } = parsed.data;
			const hint = state.hints.get(sourceId);
			if (!hint) return resolveSkillLocation(opts, parsed.data, signal);
			const location = await currentHint(opts, { sourceId, ...hint }, signal);
			if (!location.ok && location.error.code !== "aborted")
				state.hints.delete(sourceId);
			return location;
		},
		clear() {
			state.revision++;
			state.hints.clear();
		},
	};
};
