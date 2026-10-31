import type { TeamTemplate } from "@mete/contracts";
import {
	ESTIMATE_PER_APPROVAL,
	ESTIMATE_PER_CLARIFY,
	ESTIMATE_PER_JUDGE,
	ESTIMATE_PER_LESSON,
	ESTIMATE_PER_REVIEW,
	ESTIMATE_PER_TASK,
} from "../defaults.js";
import { type Seat, SINGLE_AGENT } from "./tools.js";

// The request estimate before a run starts (docs/09, Scheduler, step 6; ADR-068), without history:
// 12 per task on its role's seat, 4 per clarification on the answering role's (ADR-142), 4 per pair
// review on the pair role's (ADR-136), 3 per approval on the approver role's and 1 per lesson on the
// task's role's (ADR-145); a best-of-N task's work counts n times, plus 1 for its judge (ADR-162). A
// human approves and answers without a model request. Pure.

/** Requests one seat is estimated to make; a team seat names its role, whose pin it may have (ADR-077). */
export type EstimateEntry = Pick<Seat, "tier" | "needs"> & {
	readonly roleId?: string;
	readonly requests: number;
};

/** The requests of a template's own tasks, or of a single agent when `template` is null. */
export const estimateRequests = (
	template: TeamTemplate | null,
): EstimateEntry[] => {
	if (!template)
		return [
			{
				tier: SINGLE_AGENT.tier,
				needs: SINGLE_AGENT.needs,
				requests: ESTIMATE_PER_TASK,
			},
		];
	// A role the template does not name gets the coder tier, as its agent would (team-run.ts).
	const seat = (id: string) => {
		const role = template.roles.find((r) => r.id === id);
		return {
			roleId: id,
			tier: role?.tier ?? "coder",
			needs: [...(role?.needs ?? [])],
		};
	};
	const answers = (by: string | undefined) =>
		by && by !== "human"
			? [{ ...seat(by), requests: ESTIMATE_PER_CLARIFY }]
			: [];
	// A judge has no role, so no pin: its tier alone (ADR-162).
	const judge = (a: TeamTemplate["tasks"][number]["attempts"]) =>
		a && a.n >= 2
			? [{ tier: a.judge_tier, needs: [], requests: ESTIMATE_PER_JUDGE }]
			: [];
	return template.tasks.flatMap((t) => [
		{ ...seat(t.role), requests: ESTIMATE_PER_TASK * (t.attempts?.n ?? 1) },
		...judge(t.attempts),
		...answers(t.before_start?.clarify_with),
		...(t.approval && t.approval !== "human"
			? [{ ...seat(t.approval), requests: ESTIMATE_PER_APPROVAL }]
			: []),
		...(t.review
			? [{ ...seat(t.review.pair_with), requests: ESTIMATE_PER_REVIEW }]
			: []),
		...(t.memory?.write_lessons
			? [{ ...seat(t.role), requests: ESTIMATE_PER_LESSON }]
			: []),
	]);
};
