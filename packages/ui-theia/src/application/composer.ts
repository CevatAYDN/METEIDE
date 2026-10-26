import {
	type ModelRef,
	ModelRefSchema,
	NeedSchema,
	type RunPrefer,
	type RunStart,
	TierSchema,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type {
	DaemonFailure,
	Estimate,
	MeteDaemonService,
} from "../domain/status-service.js";
import { estimateText } from "./estimate-text.js";
import { chainKey } from "./pins-draft.js";
import { draftOf, teamOf } from "./team-draft.js";

// What the run composer's screen lists and what Start sends (ADR-058, ADR-068, ADR-071, ADR-122),
// as plain values, so the order, the estimate lines and the narrowing are tested without Theia.

/** A role in a team template for model preference selection (ADR-122). */
export type ComposerRole = {
	readonly id: string;
	readonly name: string;
	readonly models?: readonly string[];
};

/** A team the composer offers; `templateId` undefined lets the router choose, null is a single agent. */
export type ComposerOption = {
	readonly key: string;
	readonly templateId: string | null | undefined;
	readonly label: string;
	readonly description?: string;
	/** The request estimate line; the router's choice has none, and a failed estimate leaves it out. */
	readonly estimate?: string;
	/** Team roles when a template was picked (ADR-122). */
	readonly roles?: readonly ComposerRole[];
	/** Available models for selection (ADR-122). */
	readonly models?: readonly string[];
};

/** A template as `mete/templates` lists it. */
export type TemplateListing = {
	readonly id: string;
	readonly name: string;
	readonly description?: string | undefined;
	readonly roles?: readonly ComposerRole[] | undefined;
};

/** An estimate as the daemon answered it, or why it did not. */
export type EstimateReply =
	| { readonly ok: true; readonly value: Estimate }
	| { readonly ok: false; readonly error: DaemonFailure };

/** Context for fetching model chains from the daemon. */
export type ChainContext = {
	readonly daemon: MeteDaemonService;
	readonly dir: string;
	readonly cache: Map<string, readonly string[]>;
};

/** Fetches models for a tier and needs, returning strings formatted as providerId/modelId. */
export const fetchChain = async (
	ctx: ChainContext,
	tierName: string,
	needsList: readonly string[] = [],
): Promise<readonly string[]> => {
	const tier = TierSchema.safeParse(tierName);
	if (!tier.success) return [];
	const validNeeds = (needsList ?? []).filter(
		(n) => NeedSchema.safeParse(n).success,
	);
	const needs = NeedSchema.array().parse(validNeeds);
	const key = chainKey(tier.data, needs);
	const hit = ctx.cache.get(key);
	if (hit) return hit;
	try {
		const res = await ctx.daemon.chain(ctx.dir, tier.data, needs);
		const models = res.ok
			? res.value.models.map((m) => `${m.providerId}/${m.modelId}`)
			: [];
		ctx.cache.set(key, models);
		return models;
	} catch {
		return [];
	}
};

/** Loads template files and populates their roles with chain models. */
export const loadRoles = async (
	ctx: ChainContext,
	templates: readonly TemplateListing[],
): Promise<TemplateListing[]> =>
	Promise.all(
		templates.map(async (t) => {
			try {
				const read = await ctx.daemon.readTemplate(ctx.dir, t.id);
				if (!read.ok) return t;
				const draft = draftOf(read.value.yaml);
				if (!draft.ok) return t;
				const roles = await Promise.all(
					teamOf(draft.value)
						.roles.filter((r) => r.id.trim().length > 0)
						.map(async (r) => ({
							id: r.id,
							name: r.name || r.id,
							models: await fetchChain(ctx, r.tier, r.needs),
						})),
				);
				return { ...t, roles };
			} catch {
				return t;
			}
		}),
	);

const lineOf = (reply: EstimateReply | undefined, team: boolean) =>
	reply?.ok ? { estimate: estimateText(reply.value, team) } : {};

/**
 * "Let METE choose", each template by name with its description, "Single agent" (ADR-058); the
 * estimates come in the order of the templates, then the single agent's (ADR-068).
 */
export const optionsOf = (
	templates: readonly TemplateListing[],
	estimates: readonly (EstimateReply | undefined)[],
	singleModels?: readonly string[],
): ComposerOption[] => [
	{
		key: "choose",
		templateId: undefined,
		label: nls.localize("mete/run/choose", "Let METE choose"),
	},
	...templates.map((t, i) => ({
		key: t.id,
		templateId: t.id,
		label: t.name,
		...(t.description ? { description: t.description } : {}),
		...(t.roles ? { roles: t.roles } : {}),
		...lineOf(estimates[i], true),
	})),
	{
		key: "single",
		templateId: null,
		label: nls.localize("mete/run/single", "Single agent"),
		...(singleModels ? { models: singleModels } : {}),
		...lineOf(estimates[templates.length], false),
	},
];

/** The router's suggestions, then a single agent: what the list narrows to when the router is unsure. */
export const narrowedTo = (
	suggestions: readonly string[],
	all: readonly ComposerOption[],
): ComposerOption[] => [
	...suggestions.map(
		(id) =>
			all.find((o) => o.templateId === id) ?? {
				key: id,
				templateId: id,
				label: id,
			},
	),
	...all.filter((o) => o.templateId === null),
];

/** A single model reference parsed from `<providerId>/<modelId>` (ADR-122). */
export const modelRefOf = (value?: string): ModelRef | undefined => {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const at = trimmed.indexOf("/");
	if (at <= 0) return undefined;
	const r = ModelRefSchema.safeParse({
		providerId: trimmed.slice(0, at).trim(),
		modelId: trimmed.slice(at + 1).trim(),
	});
	return r.success ? r.data : undefined;
};

const teamPreferOf = (
	roleModels: Readonly<Record<string, string>>,
	allowedRoles?: readonly string[],
): Record<string, ModelRef> | undefined => {
	const allowed = allowedRoles ? new Set(allowedRoles) : undefined;
	const out: Record<string, ModelRef> = {};
	for (const [roleId, str] of Object.entries(roleModels)) {
		if (allowed && !allowed.has(roleId)) continue;
		const ref = modelRefOf(str);
		if (ref) out[roleId] = ref;
	}
	return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * Resolves the run model preference (ADR-122):
 * - single agent: ModelRef or undefined
 * - team run: Record<string, ModelRef> or undefined (filtered to allowed roles if given)
 */
export const preferOf = (
	templateId: string | null | undefined,
	singleModel?: string | undefined,
	roleModels?: Readonly<Record<string, string>> | undefined,
	allowedRoles?: readonly string[],
): RunPrefer | undefined => {
	if (templateId === null) return modelRefOf(singleModel);
	if (typeof templateId === "string" && roleModels) {
		return teamPreferOf(roleModels, allowedRoles);
	}
	return undefined;
};

/** The request Start sends: the goal, the team, and optional model preference (ADR-122). */
export const startOf = (
	goal: string,
	option: ComposerOption,
	prefer?: RunPrefer,
): RunStart => {
	const base: RunStart = {
		goal: goal.trim(),
		...(option.templateId === undefined
			? {}
			: { templateId: option.templateId }),
	};
	if (option.templateId === undefined || !prefer) return base;
	if (option.templateId === null) {
		return "providerId" in prefer ? { ...base, prefer } : base;
	}
	return !("providerId" in prefer) && Object.keys(prefer).length > 0
		? { ...base, prefer }
		: base;
};
