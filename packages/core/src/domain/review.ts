import { type ChatMessage, DecisionSchema } from "@mete/contracts";
import { z } from "zod";
import { jsonOf } from "./guardrail.js";
import type { Platform } from "./prompt.js";
import type { TeamState } from "./team.js";

// An approver role's or a pair reviewer's review of a submitted task (docs/08, Task execution
// sequence, steps 7 and 5; ADR-136): findings first, then the verdict (ADR-134). Pure.

/** A reviewer's verdict; a revision says what to change. */
export const VerdictSchema = z
	.strictObject({
		decision: DecisionSchema,
		feedback: z.string().trim().min(1).optional(),
	})
	.refine((v) => v.decision === "approve" || v.feedback !== undefined, {
		message: "a revise verdict needs feedback",
		path: ["feedback"],
	});

/** A checked verdict. */
export type Verdict = z.output<typeof VerdictSchema>;

// Every fenced block of a reply; the verdict comes after the findings, which may quote code (ADR-134).
const FENCES = /```[^\n]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

const verdictJson = (reply: string) =>
	jsonOf(reply) ??
	[...reply.matchAll(FENCES)].flatMap((m) => jsonOf(m[1] ?? "") ?? []).at(-1);

/** The reviewer's verdict from its reply, or what is wrong with it. */
export const checkVerdict = (
	reply: string,
): { ok: true; verdict: Verdict } | { ok: false; issues: string } => {
	const json = verdictJson(reply);
	if (!json) return { ok: false, issues: "the reply is not JSON" };
	const r = VerdictSchema.safeParse(json.value);
	return r.success
		? { ok: true, verdict: r.data }
		: { ok: false, issues: z.prettifyError(r.error) };
};

/** The user message that asks the reviewer for a valid verdict. */
export const verdictRepair = (issues: string) =>
	`Your verdict is not valid:\n${issues}\nReply again without calling a tool, with only the JSON object.`;

/** The opening of a review: the approver's role, then the task and its report. */
export const reviewConversation = (
	team: TeamState,
	id: string,
	{ approver, goal }: { approver: string; goal: string },
	where: Platform,
): ChatMessage[] => {
	const role = team.template.roles.find((r) => r.id === approver);
	const task = team.template.tasks.find((t) => t.id === id);
	const system = [
		`You are ${role?.name ?? approver}, one member of a team.`,
		`Your goal: ${role?.goal ?? "approve or return work"}.`,
		"You review a teammate's submission. Check it against the task and the team goal, and read the files it names before you decide.",
		"Return it with feedback when anything in it is wrong, even if the goal did not forbid it: a misspelled or broken word, text in a script the goal's language does not use, broken markup, a count, a language or a format the goal names that the files do not match, or a claim the files do not support. Approve it only when you found nothing wrong.",
		"When you decide, reply without calling a tool. First write your findings as plain lines: quote each sentence of text a reader of the files will see (not code, markup or styles; for a long text, its headings and first 30 sentences) and mark it right, or wrong with its fix, in the language the goal names; then check, one by one, each thing the goal names or counts.",
		'End with your verdict as a JSON object in a ```json block: {"decision": "approve"} or {"decision": "revise", "feedback": "what to change"}.',
		`Operating system: ${where.os}. Shell: ${where.shell}.`,
	].join("\n");
	const report = team.tasks[id]?.context.report ?? "";
	const user = `Team goal: ${goal}\n\nTask: ${task?.title ?? id}\n\nSubmission:\n${report}`;
	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
};
