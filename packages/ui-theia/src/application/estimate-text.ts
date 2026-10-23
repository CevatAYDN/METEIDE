import { nls } from "@theia/core/lib/common/nls";
import type { Estimate } from "../domain/status-service.js";

// The run composer's estimate line (ADR-068, docs/09 Scheduler step 6): the total, then each ready
// provider's share in the order mete/quota lists them, then the requests no ready provider takes.
// Tasks a team adds while it works (spawns, ADR-057) are not in the estimate, so a team's line says so.

/** One line for a composer item; `team` is true for a template, false for a single agent. */
export const estimateText = (e: Estimate, team: boolean) => {
	const total = e.unassigned + e.providers.reduce((n, p) => n + p.requests, 0);
	const parts = [
		...e.providers.map((p) => `${p.providerId} ${p.requests}`),
		...(e.unassigned > 0
			? [nls.localize("mete/run/unassigned", "{0} unassigned", e.unassigned)]
			: []),
	];
	const line =
		e.providers.length === 0
			? nls.localize(
					"mete/run/estimateNone",
					"{0} requests, no provider ready",
					total,
				)
			: nls.localize(
					"mete/run/estimate",
					"{0} requests: {1}",
					total,
					parts.join(" · "),
				);
	return team
		? `${line}; ${nls.localize("mete/run/estimateSpawned", "tasks the team adds come on top")}`
		: line;
};
