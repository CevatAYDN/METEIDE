import type { ProviderState, Result } from "@mete/contracts";
import type { DaemonFailure, StatusRuns } from "./status-service.js";

// What the Home panel shows (docs/13, Home: recent runs, and the approvals inbox of ADR-048), with
// the providers that cannot help under a run paused for quota (ADR-050). The time the answer was
// taken travels with it.

/** One run as the panel lists it. */
export type HomeRow = {
	readonly id: string;
	readonly status: string;
	readonly goal: string;
	readonly templateId: string | null;
	readonly createdAt: string;
	/** Paused for approval: the run waits for the human (ADR-048). */
	readonly waiting: boolean;
	/** Paused for quota: it goes on when a provider can carry it (ADR-044). */
	readonly quotaPaused: boolean;
	/** Paused by the user, as a desktop quit does: it goes on only when resumed (ADR-061). */
	readonly userPaused: boolean;
};

/** The panel's state: waiting for the daemon, no folder open, the runs, or why there are none. */
export type HomeModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| {
			readonly kind: "runs";
			readonly rows: readonly HomeRow[];
			/** Every provider's state, the quota summary of docs/13 (ADR-050); empty when the ask failed. */
			readonly providers: readonly ProviderState[];
			/** The providers that cannot carry a run on now, listed under a run that waits for quota. */
			readonly blocked: readonly ProviderState[];
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

/** How many runs wait for the human: the Approvals inbox badge (docs/13), none without runs. */
export const waitingCount = (model: HomeModel) =>
	model.kind === "runs" ? model.rows.filter((r) => r.waiting).length : 0;

/** A run paused by the user, or by a desktop quit, goes on only when someone resumes it (ADR-061). */
export const waitsForUser = (r: StatusRuns[number]) =>
	r.status === "paused" && r.pauseReason === "user";

/** A run paused for quota goes on by itself once a provider can carry it. */
export const waitsForQuota = (r: StatusRuns[number]) =>
	r.status === "paused" && r.pauseReason === "quota";

/**
 * Turns a `mete/status` reply into what the panel shows, taken at `at` (ISO 8601), with the
 * `mete/quota` states when the panel asked for them.
 */
export const homeModel = (
	reply: Result<StatusRuns, DaemonFailure>,
	at: string,
	providers: readonly ProviderState[] = [],
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
					quotaPaused: waitsForQuota(r),
					userPaused: waitsForUser(r),
				})),
				providers,
				blocked: providers.filter((p) => p.state !== "ready"),
				at,
			}
		: { kind: "failed", failure: reply.error, at };

/**
 * Whether a run here is running or queued: its daemon ends when this window takes another folder,
 * so another folder then opens in a new window (ADR-078).
 */
export const runsHere = (model: HomeModel) =>
	model.kind === "runs" &&
	model.rows.some((r) => r.status === "running" || r.status === "queued");
