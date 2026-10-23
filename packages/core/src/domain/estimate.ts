import type { TeamTemplate } from "@mete/contracts";
import { ESTIMATE_PER_APPROVAL, ESTIMATE_PER_TASK } from "../defaults.js";
import { type Seat, SINGLE_AGENT } from "./tools.js";

// The request estimate before a run starts (docs/09, Scheduler, step 6; ADR-068), without history:
// 12 per task on its role's seat and 3 per approval on the approver role's. A human approves without
// a model request, and the review term joins when core runs pair review (docs/08). Pure.

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
	return template.tasks.flatMap((t) => [
		{ ...seat(t.role), requests: ESTIMATE_PER_TASK },
		...(t.approval && t.approval !== "human"
			? [{ ...seat(t.approval), requests: ESTIMATE_PER_APPROVAL }]
			: []),
	]);
};
