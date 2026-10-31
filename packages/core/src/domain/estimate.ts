import type { TeamTemplate } from "@mete/contracts";
import {
	ESTIMATE_PER_APPROVAL,
	ESTIMATE_PER_CLARIFY,
	ESTIMATE_PER_EMBED,
	ESTIMATE_PER_JUDGE,
	ESTIMATE_PER_LESSON,
	ESTIMATE_PER_REVIEW,
	ESTIMATE_PER_TASK,
} from "../defaults.js";
import { type Seat, SINGLE_AGENT } from "./tools.js";

// The request estimate before a run starts (docs/09, Scheduler, step 6; ADR-068), without history:
// 12 per task on its role's seat, 4 per clarification on the answering role's (ADR-142), 4 per pair
// review on the pair role's (ADR-136), 3 per approval on the approver role's and 1 per lesson on the
// task's role's (ADR-145); a best-of-N task's work counts n times, plus 1 for its judge (ADR-162); with
// embedding on, each start of a team task's work counts 1 query embedding on the embedding chain
// (ADR-152). A human approves and answers without a model request. Pure.

/** Requests one seat is estimated to make; a team seat names its role, whose pin it may have (ADR-077). */
export type SeatEntry = Pick<Seat, "tier" | "needs"> & {
	readonly roleId?: string;
	readonly requests: number;
};

/** Requests for query embeddings, which go to the embedding chain, not a seat's (ADR-152). */
export type EmbedEntry = { readonly embed: true; readonly requests: number };

export type EstimateEntry = SeatEntry | EmbedEntry;

type Attempts = TeamTemplate["tasks"][number]["attempts"];

// A judge has no role, so no pin: its tier alone (ADR-162).
const judge = (a: Attempts): SeatEntry[] =>
	a && a.n >= 2
		? [{ tier: a.judge_tier, needs: [], requests: ESTIMATE_PER_JUDGE }]
		: [];

/** The requests of a template's own tasks, or of a single agent when `template` is null; `embed` when query embeddings would be made. */
export const estimateRequests = (
	template: TeamTemplate | null,
	embed = false,
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
	// The lessons search runs at each start of a task's work, attempts included (team-driver.ts).
	const embeds = (a: Attempts): EmbedEntry[] =>
		embed ? [{ embed: true, requests: ESTIMATE_PER_EMBED * (a?.n ?? 1) }] : [];
	return template.tasks.flatMap((t) => [
		{ ...seat(t.role), requests: ESTIMATE_PER_TASK * (t.attempts?.n ?? 1) },
		...judge(t.attempts),
		...embeds(t.attempts),
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
