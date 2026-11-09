import type { SkillOwner } from "@mete/contracts";
import type { RunContext } from "./run-types.js";
import { contextOf } from "./skill-context.js";
import type { SkillContextState } from "./skill-state.js";

/** The seat a model call fills; only an ordinary worker or the single agent owns skills. */
type Seat = Pick<
	RunContext,
	"team" | "task" | "review" | "clarify" | "judge" | "skills"
>;

/** Reviewers, answerers and judges never get a skill context (ADR-190). */
const isOrdinaryWorker = (c: Seat) =>
	c.review === undefined && c.clarify === undefined && !c.judge;

/**
 * The live attempt id of a task: the task's own id for attempt 1, the attempt's id after
 * (ADR-162). A model fallback or revision keeps it; a fresh attempt gets a new one.
 */
const attemptOf = (c: Seat) => {
	const entry = c.team && c.task ? c.team.tasks[c.task] : undefined;
	return entry ? (entry.attempts?.id ?? entry.id) : undefined;
};

/** The role a task attempt works as, from its template task. */
const roleOf = (c: Seat) =>
	c.team && c.task
		? c.team.template.tasks.find(({ id }) => id === c.task)?.role
		: undefined;

/**
 * The skill owner of the seat about to call the model, or undefined when it has none.
 * Single agent: its assistant context. Team worker: `{ taskId, attemptId }` of the live attempt.
 */
export const seatOwner = (
	c: Seat,
	newContextId: () => string,
): { owner: SkillOwner; roleId: string } | undefined => {
	const skills = c.skills;
	if (!skills || !isOrdinaryWorker(c)) return undefined;
	if (!c.team) {
		const single = skills.contexts.find(
			({ roleId, owner }) => roleId === "assistant" && !owner.taskId,
		);
		return single && { owner: single.owner, roleId: "assistant" };
	}
	const entry = c.task ? c.team.tasks[c.task] : undefined;
	const attemptId = attemptOf(c);
	const roleId = roleOf(c);
	if (!entry || !attemptId || !roleId) return undefined;
	const existing = skills.contexts.find(
		({ owner }) => owner.taskId === entry.id && owner.attemptId === attemptId,
	);
	return {
		owner: existing?.owner ?? {
			runId: skills.runId,
			contextId: newContextId(),
			taskId: entry.id,
			attemptId,
		},
		roleId,
	};
};

/** The retained context of a seat, without creating one. */
export const seatContext = (c: Seat): SkillContextState | undefined => {
	const seat = seatOwner(c, () => "");
	return seat && c.skills ? contextOf(c.skills, seat.owner) : undefined;
};
