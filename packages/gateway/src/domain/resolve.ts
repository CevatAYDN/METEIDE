import type { LlmChatRequest, ModelInfo, Privacy, Tier } from "@mete/contracts";
import { LONG_CONTEXT_MIN, TIER_MIN_CONTEXT } from "../defaults.js";

// Tier resolution and the privacy filter (docs/09, Tier resolution and Privacy).

/** A discovered model with its provider's privacy facts. */
export type Discovered = {
	readonly model: ModelInfo;
	readonly privacy: Privacy;
};

/** The user's privacy switch and the workspace's sensitivity. */
export type PrivacyRules = {
	readonly allowTraining: boolean;
	readonly sensitive: boolean;
};

type Need = NonNullable<LlmChatRequest["needs"]>[number];
type Role = Pick<LlmChatRequest, "needs" | "avoidFamilies">;

// "unknown" counts as true; only a normal workspace honours allowTraining.
const passesPrivacy = (p: Privacy, rules: PrivacyRules) =>
	(rules.allowTraining && !rules.sensitive) ||
	(p.trains === false && p.publishes === false);

const meetsTier = (m: ModelInfo, tier: Tier) =>
	m.contextWindow >= TIER_MIN_CONTEXT[tier] &&
	(tier !== "coder" || m.toolCalling === true) &&
	(tier !== "vision" || m.vision === true);

const meetsNeed = (m: ModelInfo, need: Need) => {
	if (need === "tool_calling") return m.toolCalling === true;
	if (need === "vision") return m.vision === true;
	return m.contextWindow >= LONG_CONTEXT_MIN;
};

// Avoided families go only while another candidate is left.
const avoid = (list: ModelInfo[], families: readonly string[]) => {
	const kept = list.filter((m) => !families.includes(m.family));
	return kept.length > 0 ? kept : list;
};

/** Discovered models that are free, not deprecated and pass the privacy filter. */
export const usableModels = (
	found: readonly Discovered[],
	rules: PrivacyRules,
): ModelInfo[] =>
	found
		.filter(
			(d) =>
				d.model.free && !d.model.deprecated && passesPrivacy(d.privacy, rules),
		)
		.map((d) => d.model);

/** The candidates for one call, best first; quota picks the first open one. Empty when none fits. */
export const resolveChain = (
	found: readonly Discovered[],
	target: LlmChatRequest["target"],
	rules: PrivacyRules,
	role: Role = {},
): ModelInfo[] => {
	const usable = usableModels(found, rules);
	if (!("tier" in target))
		return usable.filter(
			(m) => m.providerId === target.providerId && m.id === target.modelId,
		);
	const fit = usable.filter(
		(m) =>
			meetsTier(m, target.tier) &&
			(role.needs ?? []).every((n) => meetsNeed(m, n)),
	);
	return avoid(fit, role.avoidFamilies ?? []).sort(
		(a, b) => b.contextWindow - a.contextWindow,
	);
};
