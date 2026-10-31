import type { ChatMessage } from "@mete/contracts";
import { z } from "zod";
import { JUDGE_CANDIDATE_CHARS } from "../defaults.js";
import { verdictJson } from "./review.js";
import type { TeamState } from "./team.js";

// The judge of a best-of-N task (docs/08, Task execution sequence; ADR-162): when two or more
// attempts passed their checks, an agent of `judge_tier` with no tools reads each candidate's
// report, changed files and diff, opened as an approver's review is (ADR-134), and names the
// attempt that goes on. It ranks and does not approve. Pure.

/** What the judge reads of one candidate. */
export type Candidate = {
	readonly k: number;
	readonly report: string;
	readonly files?: readonly string[] | undefined;
	readonly diff?: string | undefined;
};

const part = (c: Candidate) =>
	[
		`Report:\n${c.report}`,
		...(c.files?.length ? [`Files changed: ${c.files.join(", ")}`] : []),
		...(c.diff ? [`Diff:\n${c.diff}`] : []),
	]
		.join("\n\n")
		.slice(0, JUDGE_CANDIDATE_CHARS);

/** The opening of the judge's conversation: the task, then each candidate's part. */
export const judgeConversation = (
	team: TeamState,
	key: string,
	{ goal, candidates }: { goal: string; candidates: readonly Candidate[] },
): ChatMessage[] => {
	const task = team.template.tasks.find((t) => t.id === key);
	const system = [
		"You are the judge of a team's attempts at one task.",
		"Each attempt below did the same task in its own way, and each passed the task's checks. Choose the one that does the task best for the team goal: read each report, the files it changed and its diff.",
		'Reply without calling a tool. First write your findings for each attempt as plain lines; then end with your choice as a JSON object in a ```json block: {"attempt": <its number>, "reason": "why it goes on"}.',
	].join("\n");
	const parts = candidates.map((c) => `Attempt ${c.k}:\n${part(c)}`);
	const user = [
		`Team goal: ${goal}`,
		`Task: ${task?.title ?? key}`,
		...parts,
	].join("\n\n");
	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
};

const JudgeVerdictSchema = z.strictObject({
	attempt: z.number().int().positive(),
	reason: z.string().trim().min(1),
});

/** The judge's choice among `candidates`, or what is wrong with its reply. */
export const checkJudge = (
	reply: string,
	candidates: readonly number[],
):
	| { ok: true; attempt: number; reason: string }
	| { ok: false; issues: string } => {
	const json = verdictJson(reply);
	if (!json) return { ok: false, issues: "the reply is not JSON" };
	const r = JudgeVerdictSchema.safeParse(json.value);
	if (!r.success) return { ok: false, issues: z.prettifyError(r.error) };
	if (!candidates.includes(r.data.attempt))
		return {
			ok: false,
			issues: `attempt must be one of ${candidates.join(", ")}`,
		};
	return { ok: true, ...r.data };
};

/** The user message that asks the judge for a valid choice. */
export const judgeRepair = (issues: string) =>
	`Your choice is not valid:\n${issues}\nReply again without calling a tool, with only the JSON object.`;
