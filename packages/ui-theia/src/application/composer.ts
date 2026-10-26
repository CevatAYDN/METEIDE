import type { ModelRef, RunPrefer, RunStart } from "@mete/contracts";
import { ModelRefSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { DaemonFailure, Estimate } from "../domain/status-service.js";
import { estimateText } from "./estimate-text.js";

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

/**
 * Resolves the run model preference (ADR-122):
 * - single agent: ModelRef or undefined
 * - team run: Record<string, ModelRef> or undefined
 */
export const preferOf = (
	templateId: string | null | undefined,
	singleModel?: string | undefined,
	roleModels?: Readonly<Record<string, string>> | undefined,
): RunPrefer | undefined => {
	if (templateId === null) {
		return modelRefOf(singleModel);
	}
	if (typeof templateId === "string" && roleModels) {
		const out: Record<string, ModelRef> = {};
		for (const [roleId, str] of Object.entries(roleModels)) {
			const ref = modelRefOf(str);
			if (ref) out[roleId] = ref;
		}
		return Object.keys(out).length > 0 ? out : undefined;
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
	if (!prefer) return base;
	if ("providerId" in prefer) return { ...base, prefer };
	return Object.keys(prefer).length > 0 ? { ...base, prefer } : base;
};
