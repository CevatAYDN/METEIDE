import type { Result } from "@mete/contracts";
import type { DaemonFailure, StatusRuns } from "./status-service.js";

// What the Home panel shows (docs/13, Home: recent runs, and the approvals inbox of ADR-048). The
// time the answer was taken travels with it.

/** One run as the panel lists it. */
export type HomeRow = {
	readonly id: string;
	readonly status: string;
	readonly goal: string;
	readonly templateId: string | null;
	readonly createdAt: string;
	/** Paused for approval: the run waits for the human (ADR-048). */
	readonly waiting: boolean;
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

/** A run paused for approval waits for the human; the engine decides what an answer does. */
export const waitsForYou = (r: StatusRuns[number]) =>
	r.status === "paused" && r.pauseReason === "approval";

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
					waiting: waitsForYou(r),
				})),
				at,
			}
		: { kind: "failed", failure: reply.error, at };
