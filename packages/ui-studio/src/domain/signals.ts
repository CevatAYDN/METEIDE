import type { MeteEvent, PolicyAsk } from "@mete/contracts";

// What the Studio needs beyond tasks and agents (ADR-052): the roles seen approving or reviewing
// (they sit in the top row), why the run is paused and how long its pauses lasted (ADR-139), and the
// providers whose quota is spent. The quota events come from the quota module with no run: they
// belong to the workspace.
// shortcut: mete/events reads only the run's own rows, so a quota spent before the panel opened is
// seen only once mete/quota seeds it; until then the wait shows from the next quota event on.

type PauseReason = Extract<
	MeteEvent,
	{ type: "run.paused" }
>["payload"]["reason"];

/** The run's signals the Studio draws. */
export type RunSignals = {
	/** Role ids seen approving (not the human) or reviewing, in the order first seen. */
	readonly leadRoles: readonly string[];
	readonly pausedFor?: PauseReason;
	/** Milliseconds the run spent paused, its closed pauses added up (ADR-139). */
	readonly paused: number;
	/** When the open pause began; it counts once the run goes on or ends. */
	readonly pausedSince?: string;
	/** Provider id to the time its spent quota opens again. */
	readonly exhausted: Readonly<Record<string, string>>;
	/** The newest policy ask of the run, cleared when the run goes on or ends (ADR-121). */
	readonly asked?: PolicyAsk;
};

/** Before the first event. */
export const NO_SIGNALS: RunSignals = {
	leadRoles: [],
	exhausted: {},
	paused: 0,
};

const lead = (s: RunSignals, roleId: string): RunSignals =>
	s.leadRoles.includes(roleId)
		? s
		: { ...s, leadRoles: [...s.leadRoles, roleId] };

const ENDS = new Set([
	"run.started",
	"run.resumed",
	"run.completed",
	"run.failed",
	"run.cancelled",
]);

// Going on or ending closes the open pause, and its time counts.
const closed = (s: RunSignals, at: string): RunSignals => {
	const { pausedFor: _, asked: __, pausedSince, ...rest } = s;
	if (!pausedSince) return rest;
	return {
		...rest,
		paused: s.paused + Date.parse(at) - Date.parse(pausedSince),
	};
};

const quotaAfter = (s: RunSignals, e: MeteEvent): RunSignals => {
	if (e.type === "quota.exhausted")
		return {
			...s,
			exhausted: { ...s.exhausted, [e.payload.providerId]: e.payload.resetsAt },
		};
	if (e.type === "quota.restored") {
		const { [e.payload.providerId]: _, ...rest } = s.exhausted;
		return { ...s, exhausted: rest };
	}
	return s;
};

/** The signals after one event of the run or of its workspace's quota. */
export const signalsAfter = (s: RunSignals, e: MeteEvent): RunSignals => {
	if (e.type === "approval.requested" && e.payload.approver !== "human")
		return lead(s, e.payload.approver);
	if (e.type === "review.requested") return lead(s, e.payload.reviewerRoleId);
	if (e.type === "run.paused")
		return {
			...s,
			pausedFor: e.payload.reason,
			pausedSince: s.pausedSince ?? e.ts,
		};
	if (e.type === "policy.asked") {
		const { rule: _, ...asked } = e.payload;
		return { ...s, asked };
	}
	if (ENDS.has(e.type)) return closed(s, e.ts);
	return quotaAfter(s, e);
};
