import { type ModelRef, ModelRefSchema, type RunPrefer } from "@mete/contracts";
import { type ChainContext, fetchChain } from "./composer.js";
import { draftOf, teamOf } from "./team-draft.js";

// A team file's roles and the models each can run on (ADR-122): a role asks for its tier and the
// needs its seat names, as the composer asks for the single agent's coder tier.

/** The needs each role of the team file names, by role id. */
export const needsOfRoles = (
	yaml: string,
): Readonly<Record<string, readonly string[]>> => {
	const draft = draftOf(yaml);
	if (!draft.ok) return {};
	return Object.fromEntries(
		teamOf(draft.value).roles.map((r) => [r.id, r.needs]),
	);
};

/** The needs a member's chain is asked for: the team file's, or the single agent's tool calling. */
export const needsFor = (
	templateId: string | null | undefined,
	needs: Readonly<Record<string, readonly string[]>>,
	roleId: string,
): readonly string[] =>
	templateId === null ? ["tool_calling"] : (needs[roleId] ?? []);

/** Each role's candidate models, asked one role at a time. */
export const chainsOfRoles = async (
	ctx: ChainContext,
	yaml: string,
): Promise<Readonly<Record<string, readonly string[]>>> => {
	const draft = draftOf(yaml);
	if (!draft.ok) return {};
	const out: Record<string, readonly string[]> = {};
	for (const r of teamOf(draft.value).roles)
		out[r.id] = await fetchChain(ctx, r.tier, r.needs);
	return out;
};

/**
 * The run's model choice by role, as the member cards show it (ADR-125): a team run's choice is by
 * role already; the single agent's is one model, shown on its own role's card.
 */
export const preferredOf = (
	prefer: RunPrefer | undefined,
	singleRole: string,
): Record<string, string> => {
	const name = (m: ModelRef) => `${m.providerId}/${m.modelId}`;
	if (!prefer) return {};
	const one = ModelRefSchema.safeParse(prefer);
	if (one.success) return { [singleRole]: name(one.data) };
	return Object.fromEntries(
		Object.entries(prefer).map(([role, m]) => [role, name(m)]),
	);
};
