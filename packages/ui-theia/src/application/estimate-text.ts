import { nls } from "@theia/core/lib/common/nls";
import type { Estimate } from "../domain/status-service.js";

// The run composer's estimate (ADR-068, docs/09 Scheduler step 6) as the Composer board draws it
// (ADR-128): the total, then each ready provider's share in the order mete/quota lists them and the
// requests no ready provider takes, each a chip. Tasks a team adds while it works (spawns, ADR-057)
// are not in the estimate, so a team's says so.

/** A composer item's estimate: its total, its shares, and the team's note. */
export type EstimateLine = {
	readonly total: string;
	readonly shares: readonly {
		readonly text: string;
		readonly unassigned?: true;
	}[];
	readonly note?: string;
};

/** The estimate of a composer item; `team` is true for a template, false for a single agent. */
export const estimateLine = (e: Estimate, team: boolean): EstimateLine => {
	const total = e.unassigned + e.providers.reduce((n, p) => n + p.requests, 0);
	const none = e.providers.length === 0;
	return {
		total: none
			? nls.localize(
					"mete/run/estimateNone",
					"{0} requests, no provider ready",
					total,
				)
			: nls.localize("mete/run/estimateTotal", "{0} requests", total),
		shares: none
			? []
			: [
					...e.providers.map((p) => ({
						text: `${p.providerId} ${p.requests}`,
					})),
					...(e.unassigned > 0
						? [
								{
									text: nls.localize(
										"mete/run/unassigned",
										"{0} unassigned",
										e.unassigned,
									),
									unassigned: true as const,
								},
							]
						: []),
				],
		...(team
			? {
					note: nls.localize(
						"mete/run/estimateSpawned",
						"tasks the team adds come on top",
					),
				}
			: {}),
	};
};
