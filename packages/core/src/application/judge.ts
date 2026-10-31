import { JUDGE_REPAIRS } from "../defaults.js";
import { candidates, finishedOf } from "../domain/attempts.js";
import {
	type Candidate,
	checkJudge,
	judgeConversation,
	judgeRepair,
} from "../domain/judge.js";
import { setRepairs, type TeamState } from "../domain/team.js";
import { choose, settle } from "./attempts.js";
import { apply, type EngineState, type Live, stuck } from "./run-state.js";
import { worktreeChanges, worktreeDiff } from "./vcs-steps.js";

// The judge of a best-of-N task (docs/08, Task execution sequence; ADR-162): two or more attempts
// passed their checks, so an agent of `judge_tier` with no tools reads them in a conversation of its
// own and names the one that goes on; a reply with no verdict is asked for once more, then the first
// candidate goes on, so a judge never pauses a run.

const candidateOf = async (
	s: EngineState,
	l: Live,
	at: { readonly team: TeamState; readonly task: string; readonly k: number },
): Promise<Candidate> => {
	const f = finishedOf(at.team, at.task, at.k);
	const base = { k: at.k, report: f?.report ?? "" };
	if (!f?.worktree) return base;
	const where = { runId: l.meta.id, worktree: f.worktree };
	const files = await worktreeChanges(s.deps, where, l.all.signal);
	const diff = await worktreeDiff(s.deps, where, l.all.signal);
	return { ...base, files, diff };
};

/** Opens the judge's conversation over the candidates' reports, changed files and diffs. */
export const openJudge = async (s: EngineState, l: Live) => {
	const { team, task, goal } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const parts: Candidate[] = [];
	for (const k of candidates(team, task))
		parts.push(await candidateOf(s, l, { team, task, k }));
	// A run paused meanwhile keeps the judge's conversation, as it keeps a finished tool call (docs/08).
	const messages = judgeConversation(team, task, { goal, candidates: parts });
	const fresh = setRepairs(team, task, 0);
	apply(s, l, { type: "SWITCH", task, team: fresh, messages, judge: true });
};

/** Takes the judge's reply: its choice goes on, or the first candidate after one more ask. */
export const judged = async (s: EngineState, l: Live, reply: string) => {
	const { team, task } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const passed = candidates(team, task);
	const checked = checkJudge(reply, passed);
	const repairs = team.tasks[task]?.repairs ?? 0;
	if (!checked.ok && repairs < JUDGE_REPAIRS) {
		const counted = setRepairs(team, task, repairs + 1);
		const content = judgeRepair(checked.issues);
		return apply(s, l, { type: "REPAIR", team: counted, content });
	}
	const choice = checked.ok
		? ({ k: checked.attempt, by: "judge", reason: checked.reason } as const)
		: ({ k: passed[0] ?? 1, by: "checks" } as const);
	await settle(s, l, choose(s, l, choice));
};
