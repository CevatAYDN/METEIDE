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
import { endAttempt, land } from "./submission.js";
import { dropWorktree } from "./vcs-steps.js";

// The checks of a best-of-N task's attempt are done (docs/08, steps 2 to 4; ADR-162): the next
// attempt starts, a judge chooses among the candidates, or one attempt goes on and the task is
// submitted or blocked as any task is.

/** What goes on: submit the report of the chosen attempt, or block the last one with its problems. */
export type GoesOn =
	| {
			readonly kind: "submit";
			readonly report: string;
			readonly messages: readonly ChatMessage[];
	  }
	| { readonly kind: "block"; readonly messages: readonly ChatMessage[] };

/** What the task does next: start its next attempt, open the judge, or go on with one attempt. */
export type AfterAttempt =
	| { readonly kind: "next" }
	| { readonly kind: "judging" }
	| GoesOn;

/** Who chose attempt k: its checks, or a judge with its reason. */
export type Choice = {
	readonly k: number;
	readonly by: "checks" | "judge";
	readonly reason?: string | undefined;
};

/**
 * Attempt k goes on: recorded with the end of a judge's conversation, and announced when its checks
 * passed. An attempt with no report is the last one, which is blocked with its problems.
 */
export const choose = (s: EngineState, l: Live, choice: Choice): GoesOn => {
	const { team, task, messages } = l.snapshot.context;
	if (!team || !task) return { kind: "block", messages };
	const went = goOn(team, task, choice.k);
	apply(s, l, { type: "REVIEWED", team: went });
	const record = finishedOf(went, task, choice.k);
	const kept = record?.messages ?? messages;
	if (record?.report === undefined) return { kind: "block", messages: kept };
	const payload = {
		attempt: choice.k,
		of: attemptsOf(team, task),
		by: choice.by,
		...(choice.reason ? { reason: choice.reason } : {}),
	};
	emit(s, l, { type: "task.attempt.chosen", payload }, team.tasks[task]?.id);
	return { kind: "submit", report: record.report, messages: kept };
};

/**
 * Ends the live attempt with its report when its checks passed. Before the last one the next attempt
 * is recorded, so its worktree is named in the snapshot before git makes it; after the last one a
 * lone candidate is chosen by its checks, none leaves the last attempt blocked, and two or more wait
 * for the judge. A task resubmitted after its last attempt was recorded is not recorded twice.
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
	const all = k > n ? team : finishAttempt(team, task, done);
	apply(s, l, { type: "TEAM", team: all });
	const passed = candidates(all, task);
	if (passed.length >= 2) return { kind: "judging" };
	return choose(s, l, { k: passed[0] ?? n, by: "checks" });
};

/** Removes the worktrees of the attempts that do not go on, once the task records the one that does. */
export const dropLeftBehind = async (s: EngineState, l: Live) => {
	const { team, task } = l.snapshot.context;
	if (!team || !task) return;
	for (const taskId of leftBehind(team, task))
		await dropWorktree(s.deps, { runId: l.meta.id, taskId }, l.all.signal);
};

/** The attempt that goes on is submitted, or the last one blocked; the others' worktrees go after the record. */
export const settle = async (s: EngineState, l: Live, then: GoesOn) => {
	if (then.kind === "submit") await land(s, l, then);
	else endAttempt(s, l, { type: "BLOCK", reason: "guardrail" }, then);
	await dropLeftBehind(s, l);
};
