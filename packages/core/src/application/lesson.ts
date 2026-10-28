import type { CapabilityRef, ChatMessage } from "@mete/contracts";
import { LESSON_ASK, lessonNote } from "../domain/lesson.js";
import { type TeamState, withLesson } from "../domain/team.js";
import { seatOf } from "../domain/team-run.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	toolContext,
} from "./run-state.js";
import { callModel, runCapability } from "./steps.js";

// docs/08, step 8 (ADR-145): once a task with memory.write_lessons is approved and merged, its agent
// gets one turn without tools for a lesson@1, which the core writes through vault.write@1. The turn
// is a cloud request of the budget, not an agent turn, as a summary is; a lesson that cannot be had
// is skipped with a warning, and the run never pauses for it.

const VAULT: CapabilityRef = "vault.write@1";

// Why no model call is worth its request, checked before it is made.
const blocked = (s: EngineState, l: Live) => {
	if (!s.deps.registry.has(VAULT)) return "no vault";
	const spent = l.snapshot.context.requests >= l.meta.budget.cloudRequests;
	return spent ? "the budget's cloud requests are spent" : undefined;
};

// Ends the step on the team as it is now, so the lesson is asked once whatever happened meanwhile.
const done = (
	s: EngineState,
	l: Live,
	id: string,
	end: { readonly replied: boolean; readonly skipped?: string },
) => {
	const team = l.snapshot.context.team;
	if (!team) return;
	if (end.skipped)
		s.deps.logger.warn(
			{ runId: l.meta.id, taskId: team.tasks[id]?.id },
			`lesson skipped: ${end.skipped}`,
		);
	const lesson = end.skipped ? "skipped" : "written";
	const event = { type: "LEARNED", replied: end.replied } as const;
	apply(s, l, { ...event, team: withLesson(team, id, lesson) });
};

// The agent's reply to the lesson ask: its own conversation, its role's tier, no tools.
const ask = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const model = new AbortController();
	l.model = model;
	const signal = AbortSignal.any([l.all.signal, model.signal]);
	const question: ChatMessage = { role: "user", content: LESSON_ASK };
	const run = {
		runId: l.meta.id,
		priority: l.snapshot.context.priority,
		messages: [...(team.tasks[id]?.messages ?? []), question],
		seat: { ...seatOf(team, id), capabilities: [] },
	};
	return callModel(s.deps, run, () => {}, signal).finally(() => {
		l.model = undefined;
	});
};

/** Asks an approved task's agent for its lesson and writes it through vault.write@1. */
export const lessonTurn = async (
	s: EngineState,
	l: Live,
	team: TeamState,
	id: string,
) => {
	const why = blocked(s, l);
	if (why) return done(s, l, id, { replied: false, skipped: why });
	const out = await ask(s, l, team, id);
	// Paused or cancelled meanwhile: the reply is dropped and the lesson asked again on resume.
	if (l.snapshot.value !== "running") return;
	if (out.kind !== "replied") {
		const skipped = out.kind === "error" ? out.error.code : "no model";
		return done(s, l, id, { replied: false, skipped });
	}
	const note = lessonNote(out.message.content);
	if (!note)
		return done(s, l, id, {
			replied: true,
			skipped: "the reply is no lesson@1",
		});
	const entry = team.tasks[id];
	const agent = entry?.context.agentId;
	const ctx = { ...toolContext(l), ...(agent ? { agentId: agent } : {}) };
	const call = { ref: VAULT, input: note };
	const written = await runCapability(s.deps, call, ctx, (body) =>
		emit(s, l, body, entry?.id),
	);
	done(s, l, id, {
		replied: true,
		...(written.ok ? {} : { skipped: written.error.code }),
	});
};
