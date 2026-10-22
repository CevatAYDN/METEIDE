import type { ChatMessage, TeamTemplate } from "@mete/contracts";
import { z } from "zod";
import { ROUTER_MIN_CONFIDENCE } from "../defaults.js";
import { jsonOf } from "./guardrail.js";

// The router of docs/08: one fast-tier call sorts a request into a single agent or a team
// template; below ROUTER_MIN_CONFIDENCE the user chooses. Pure.

const RouteSchema = z.object({
	mode: z.enum(["single", "team"]),
	templateId: z.string().optional(),
	confidence: z.number().min(0).max(1),
});

/** Where a request goes: a single agent, a template, the user's choice, or single for a reason. */
export type Route =
	| { readonly kind: "single" }
	| { readonly kind: "team"; readonly templateId: string }
	| { readonly kind: "choose"; readonly suggestions: readonly string[] }
	| { readonly kind: "fallback"; readonly why: string };

/** The router's question: the request and the templates it may pick, answered as JSON. */
export const routeRequest = (
	goal: string,
	templates: readonly TeamTemplate[],
): ChatMessage[] => [
	{
		role: "system",
		content: [
			"You sort a request for a team of AI agents. A simple request runs as one agent (mode single); never pick a team for a simple task.",
			"Pick a team template only when the request needs that team's roles and steps.",
			'Reply with only this JSON: {"mode": "single" | "team", "templateId": "<id, for team>", "confidence": <0 to 1>}.',
		].join("\n"),
	},
	{
		role: "user",
		content: [
			`Request: ${goal}`,
			"Templates:",
			...templates.map(
				(t) =>
					`- ${t.metadata.id}: ${t.metadata.name}${t.metadata.description ? ` (${t.metadata.description})` : ""}`,
			),
		].join("\n"),
	},
];

/** Where the router's reply sends the request; a reply that is no route falls back to single. */
export const routeOf = (
	reply: string,
	templates: readonly TeamTemplate[],
): Route => {
	const parsed = RouteSchema.safeParse(jsonOf(reply)?.value);
	if (!parsed.success)
		return { kind: "fallback", why: "the router's reply is no route" };
	const ids = templates.map((t) => t.metadata.id);
	const { mode, templateId, confidence } = parsed.data;
	const known = templateId !== undefined && ids.includes(templateId);
	if (confidence < ROUTER_MIN_CONFIDENCE)
		return { kind: "choose", suggestions: known ? [templateId] : ids };
	if (mode === "single") return { kind: "single" };
	return known
		? { kind: "team", templateId }
		: {
				kind: "fallback",
				why: `the router named no known template (${templateId ?? "none"})`,
			};
};
