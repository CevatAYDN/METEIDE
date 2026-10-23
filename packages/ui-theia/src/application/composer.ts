import type { RunStart } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { DaemonFailure, Estimate } from "../domain/status-service.js";
import { estimateText } from "./estimate-text.js";

// What the run composer's screen lists and what Start sends (ADR-058, ADR-068, ADR-071), as plain
// values, so the order, the estimate lines and the narrowing are tested without Theia.

/** A team the composer offers; `templateId` undefined lets the router choose, null is a single agent. */
export type ComposerOption = {
	readonly key: string;
	readonly templateId: string | null | undefined;
	readonly label: string;
	readonly description?: string;
	/** The request estimate line; the router's choice has none, and a failed estimate leaves it out. */
	readonly estimate?: string;
};

/** A template as `mete/templates` lists it. */
export type TemplateListing = {
	readonly id: string;
	readonly name: string;
	readonly description?: string | undefined;
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
		...lineOf(estimates[i], true),
	})),
	{
		key: "single",
		templateId: null,
		label: nls.localize("mete/run/single", "Single agent"),
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

/** The request Start sends: the goal, and the team only when one was picked. */
export const startOf = (goal: string, option: ComposerOption): RunStart => ({
	goal: goal.trim(),
	...(option.templateId === undefined ? {} : { templateId: option.templateId }),
});
