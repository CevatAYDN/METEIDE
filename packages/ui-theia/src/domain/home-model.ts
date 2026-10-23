import type { Result } from "@mete/contracts";
import type { DaemonFailure, StatusRuns } from "./status-service.js";

// What the Home panel shows (docs/13, Home: recent runs). The panel is a snapshot taken when it
// opens or is refreshed, so the time it was taken travels with it.

/** One recent run as the panel lists it. */
export type HomeRow = {
	readonly id: string;
	readonly status: string;
	readonly goal: string;
	readonly templateId: string | null;
	readonly createdAt: string;
};

/** The panel's state: waiting for the daemon, no folder open, the runs, or why there are none. */
export type HomeModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| {
			readonly kind: "runs";
			readonly rows: readonly HomeRow[];
			readonly at: string;
	  }
	| {
			readonly kind: "failed";
			readonly failure: DaemonFailure;
			readonly at: string;
	  };

/** Turns a `mete/status` reply into what the panel shows, taken at `at` (ISO 8601). */
export const homeModel = (
	reply: Result<StatusRuns, DaemonFailure>,
	at: string,
): HomeModel =>
	reply.ok
		? {
				kind: "runs",
				rows: reply.value.map((r) => ({
					id: r.id,
					status: r.status,
					goal: r.goal,
					templateId: r.templateId,
					createdAt: r.createdAt,
				})),
				at,
			}
		: { kind: "failed", failure: reply.error, at };
