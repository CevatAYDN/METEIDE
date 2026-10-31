import type { ChatMessage } from "@mete/contracts";
import type { z } from "zod";
import type { AttemptsSchema } from "./attempts-schema.js";
import type { RunContext } from "./run-machine.js";
import type { TeamState } from "./team.js";

// Best-of-N attempts (docs/08, Task fields; ADR-162): a task whose `attempts.n` is 2 or more works,
// verifies and checks its report up to n times, each attempt with an agent and a worktree of its
// own, and one attempt goes on. The live attempt keeps the task's own fields, as a task does today;
// the finished ones wait in a list beside it, so a restart goes on with the live attempt. Pure.

type Attempts = z.output<typeof AttemptsSchema>;
type Entry = TeamState["tasks"][string];

const entryOf = (team: TeamState, key: string) => team.tasks[key];

const withAttempts = (
	team: TeamState,
	key: string,
	update: (entry: Entry, attempts: Attempts) => Entry,
): TeamState => {
	const entry = entryOf(team, key);
	if (!entry) return team;
	const attempts = entry.attempts ?? { finished: [] };
	return { ...team, tasks: { ...team.tasks, [key]: update(entry, attempts) } };
};

/** How many attempts the task's template gives it; 1 is the path of a task without attempts. */
export const attemptsOf = (team: TeamState, key: string) =>
	team.template.tasks.find((t) => t.id === key)?.attempts?.n ?? 1;

/** Whether the task's checks decide between attempts: it has 2 or more and none goes on yet. */
export const attempting = (team: TeamState, key: string) =>
	attemptsOf(team, key) >= 2 &&
	entryOf(team, key)?.attempts?.goesOn === undefined;

/** The id that names the live attempt's worktree and branch. */
export const attemptId = (team: TeamState, key: string) => {
	const entry = entryOf(team, key);
	return entry?.attempts?.id ?? entry?.id ?? key;
};

/** Every id a task's worktrees may be named by, for removing them all (ADR-143). */
export const attemptIds = (entry: Entry) => [
	...new Set([
		entry.id,
		...(entry.attempts?.finished.map((f) => f.id) ?? []),
		...(entry.attempts?.id ? [entry.attempts.id] : []),
	]),
];

/** The attempt the working agent of the run works, for agent.created; none outside best-of-N. */
export const attemptOf = (c: RunContext) => {
	const entry = c.team && c.task ? c.team.tasks[c.task] : undefined;
	if (!c.team || !c.task || !entry || c.review || c.clarify || c.judge)
		return undefined;
	const n = attemptsOf(c.team, c.task);
	if (n < 2) return undefined;
	const k =
		entry.attempts?.goesOn ?? (entry.attempts?.finished.length ?? 0) + 1;
	return { k, n };
};

/**
 * The families a later attempt of a task with `distinct_families` avoids: those the attempts before
 * it ran on, also when it goes on and is revised; undefined when the task's pin may lead.
 */
export const avoidedFamilies = (c: RunContext) => {
	const at = attemptOf(c);
	const entry = c.team && c.task ? c.team.tasks[c.task] : undefined;
	const task = c.team?.template.tasks.find((t) => t.id === c.task);
	if (!at || at.k < 2 || !task?.attempts?.distinct_families) return undefined;
	const earlier = entry?.attempts?.finished.slice(0, at.k - 1) ?? [];
	return [...new Set(earlier.flatMap((f) => (f.family ? [f.family] : [])))];
};

/** Records how the work opened after its questions, once, for a task with attempts. */
export const withOpening = (
	team: TeamState,
	key: string,
	opening: readonly ChatMessage[],
): TeamState =>
	attemptsOf(team, key) < 2 || entryOf(team, key)?.attempts?.opening
		? team
		: withAttempts(team, key, (entry, attempts) => ({
				...entry,
				attempts: { ...attempts, opening: [...opening] },
			}));

type Done = {
	readonly messages: readonly ChatMessage[];
	readonly report?: string | undefined;
	readonly family?: string | undefined;
};

// The record of the live attempt as it ends.
const recordOf = (entry: Entry, attempts: Attempts, done: Done) => ({
	id: attempts.id ?? entry.id,
	agentId: entry.context.agentId ?? "",
	messages: [...done.messages],
	...(done.report !== undefined ? { report: done.report } : {}),
	...(entry.context.worktree ? { worktree: entry.context.worktree } : {}),
	...(done.family ? { family: done.family } : {}),
});

/**
 * Ends the live attempt: it joins the finished ones with its conversation, its report when it passed
 * and the family of its model. With `next`, the task starts its next attempt under that id: no agent
 * and no worktree yet, so the next step starts one, and the conversation as the work opened.
 */
export const finishAttempt = (
	team: TeamState,
	key: string,
	done: Done,
	next?: string,
): TeamState =>
	withAttempts(team, key, (entry, attempts) => {
		const finished = recordOf(entry, attempts, done);
		const kept = { ...attempts, finished: [...attempts.finished, finished] };
		if (next === undefined) return { ...entry, attempts: kept };
		return {
			...entry,
			context: {
				...entry.context,
				agentId: undefined,
				worktree: undefined,
				report: undefined,
				feedback: undefined,
			},
			messages: [...(attempts.opening ?? [])],
			repairs: 0,
			attempts: { ...kept, id: next },
		};
	});

/** The attempts whose checks passed, 1-based, in the order they ran. */
export const candidates = (team: TeamState, key: string) =>
	(entryOf(team, key)?.attempts?.finished ?? []).flatMap((f, i) =>
		f.report !== undefined ? [i + 1] : [],
	);

/** A finished attempt, 1-based. */
export const finishedOf = (team: TeamState, key: string, k: number) =>
	entryOf(team, key)?.attempts?.finished[k - 1];

/** Attempt k goes on: its agent, worktree, report and conversation become the task's again. */
export const goOn = (team: TeamState, key: string, k: number): TeamState =>
	withAttempts(team, key, (entry, attempts) => {
		const chosen = attempts.finished[k - 1];
		if (!chosen) return entry;
		return {
			...entry,
			context: {
				...entry.context,
				agentId: chosen.agentId,
				worktree: chosen.worktree,
				report: chosen.report,
			},
			messages: [...chosen.messages],
			attempts: {
				...attempts,
				id: chosen.id === entry.id ? undefined : chosen.id,
				goesOn: k,
			},
		};
	});

/** The ids of the finished attempts that do not go on and left a worktree, to remove once one goes on. */
export const leftBehind = (team: TeamState, key: string) => {
	const attempts = entryOf(team, key)?.attempts;
	return (attempts?.finished ?? []).flatMap((f, i) =>
		f.worktree && i + 1 !== attempts?.goesOn ? [f.id] : [],
	);
};
