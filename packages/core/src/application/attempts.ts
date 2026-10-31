import type { ChatMessage } from "@mete/contracts";
import {
	attemptsOf,
	candidates,
	finishAttempt,
	finishedOf,
	goOn,
	leftBehind,
} from "../domain/attempts.js";
import { apply, type EngineState, emit, type Live } from "./run-state.js";
import { dropWorktree } from "./vcs-steps.js";

// The checks of a best-of-N task's attempt are done (docs/08, steps 2 to 4; ADR-162): the next
// attempt starts, or one attempt goes on and the task is submitted or blocked as any task is.

/** What the task does next: start its next attempt, submit the report that goes on, or block. */
export type AfterAttempt =
	| { readonly kind: "next" }
	| {
			readonly kind: "submit";
			readonly report: string;
			readonly messages: readonly ChatMessage[];
	  }
	| { readonly kind: "block"; readonly messages: readonly ChatMessage[] };

/**
 * Ends the live attempt with its report when its checks passed. Before the last one the next attempt
 * is recorded, so its worktree is named in the snapshot before git makes it; after the last one, the
 * attempt that goes on is recorded and announced: a lone candidate is chosen by its checks, and none
 * leaves the last attempt blocked with its problems.
 */
export const afterAttempt = (
	s: EngineState,
	l: Live,
	report?: string,
): AfterAttempt => {
	const { team, task, messages } = l.snapshot.context;
	if (!team || !task) return { kind: "next" };
	const n = attemptsOf(team, task);
	const k = (team.tasks[task]?.attempts?.finished.length ?? 0) + 1;
	const done = { messages, report };
	if (k < n) {
		const next = finishAttempt(team, task, done, s.deps.newId());
		apply(s, l, { type: "TEAM", team: next });
		return { kind: "next" };
	}
	const all = finishAttempt(team, task, done);
	const passed = candidates(all, task);
	// shortcut: two or more candidates take the first, the ADR's fallback for a judge without a
	// verdict; the judge of ADR-162 (3) replaces it in the next slice.
	const chosen = passed[0] ?? n;
	const went = goOn(all, task, chosen);
	apply(s, l, { type: "TEAM", team: went });
	const record = finishedOf(went, task, chosen);
	const kept = record?.messages ?? messages;
	if (record?.report === undefined) return { kind: "block", messages: kept };
	const payload = { attempt: chosen, of: n, by: "checks" } as const;
	emit(s, l, { type: "task.attempt.chosen", payload }, team.tasks[task]?.id);
	return { kind: "submit", report: record.report, messages: kept };
};

/** Removes the worktrees of the attempts that do not go on, once the task records the one that does. */
export const dropLeftBehind = async (s: EngineState, l: Live) => {
	const { team, task } = l.snapshot.context;
	if (!team || !task) return;
	for (const taskId of leftBehind(team, task))
		await dropWorktree(s.deps, { runId: l.meta.id, taskId }, l.all.signal);
};
