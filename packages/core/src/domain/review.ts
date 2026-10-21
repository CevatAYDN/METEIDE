import { type ChatMessage, DecisionSchema } from "@mete/contracts";
import { z } from "zod";
import { jsonOf } from "./guardrail.js";
import type { Platform } from "./prompt.js";
import type { TeamState } from "./team.js";

// An approver role's review of a submitted task (docs/08, Task execution sequence, step 7). Pure.

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

/** The reviewer's verdict from its reply, or what is wrong with it. */
export const checkVerdict = (
	reply: string,
): { ok: true; verdict: Verdict } | { ok: false; issues: string } => {
	const json = jsonOf(reply);
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
		"You review a teammate's submission. Check it against the task and the team goal.",
		'When you decide, reply without calling a tool, with only a JSON object: {"decision": "approve"} or {"decision": "revise", "feedback": "what to change"}.',
		`Operating system: ${where.os}. Shell: ${where.shell}.`,
	].join("\n");
	const report = team.tasks[id]?.context.report ?? "";
	const user = `Team goal: ${goal}\n\nTask: ${task?.title ?? id}\n\nSubmission:\n${report}`;
	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
};
