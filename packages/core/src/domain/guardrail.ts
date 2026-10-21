import { artifactSchema } from "@mete/contracts";
import { z } from "zod";

// The guardrail step of docs/08 (Task execution sequence, step 4): a report must parse as its
// schema's JSON. Pure.

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;

/** A checked report: the JSON kept compact, or what is wrong with it. */
export type Checked =
	| { readonly ok: true; readonly report: string }
	| { readonly ok: false; readonly issues: string };

const parsed = (text: string): { value: unknown } | undefined => {
	const body = FENCE.exec(text.trim())?.[1] ?? text.trim();
	try {
		return { value: JSON.parse(body) };
	} catch {
		return undefined;
	}
};

/** Checks a reply against a guardrail schema such as `research-report@1`; no schema passes it. */
export const checkReport = (
	schema: string | undefined,
	reply: string,
): Checked => {
	if (schema === undefined) return { ok: true, report: reply };
	const type = artifactSchema(schema);
	if (!type) return { ok: false, issues: `${schema} has no schema` };
	const json = parsed(reply);
	if (!json) return { ok: false, issues: "the reply is not JSON" };
	const r = type.safeParse(json.value);
	return r.success
		? { ok: true, report: JSON.stringify(r.data) }
		: { ok: false, issues: z.prettifyError(r.error) };
};

/** The user message that asks the agent to repair its report. */
export const repairMessage = (schema: string, issues: string) =>
	`Your report does not match ${schema}:
${issues}
Reply again without calling a tool, with only the JSON object.`;
