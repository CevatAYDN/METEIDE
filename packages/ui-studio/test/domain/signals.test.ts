import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { applyAll, EMPTY_TEAM_VIEW } from "../../src/domain/team-view.js";

// The Studio's signals from hand-written events: lead roles, the pause, and the workspace's quota.

const RUN = crypto.randomUUID();
const event = (
	type: string,
	payload: object,
	runId: string | null = RUN,
): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-23T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		...(runId ? { runId } : {}),
		source: runId ? "core-engine" : "quota",
		type,
		payload,
	}) as MeteEvent;

describe("the Studio's signals", () => {
	it("names the roles seen approving or reviewing, once each, and never the human", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("approval.requested", { approver: "lead" }),
			event("review.requested", { reviewerRoleId: "tester" }),
			event("approval.requested", { approver: "lead" }),
			event("approval.requested", { approver: "human" }),
		]);
		expect(view.signals.leadRoles).toEqual(["lead", "tester"]);
	});

	it("keeps why the run is paused until it goes on or ends", () => {
		const paused = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("run.paused", { reason: "quota" }),
		]);
		expect(paused.signals.pausedFor).toBe("quota");
		const resumed = applyAll(RUN, paused, [event("run.resumed", {})]);
		expect(resumed.signals.pausedFor).toBeUndefined();
	});

	it("takes the workspace's quota events, which name no run, but no other run's events", () => {
		const resetsAt = "2026-10-24T00:00:00.000Z";
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event(
				"quota.exhausted",
				{ providerId: "groq", unit: "requests_per_day", resetsAt },
				null,
			),
			event(
				"quota.exhausted",
				{ providerId: "nvidia", unit: "requests_per_minute", resetsAt },
				null,
			),
			event(
				"quota.restored",
				{ providerId: "nvidia", unit: "requests_per_minute" },
				null,
			),
			event("run.paused", { reason: "user" }, crypto.randomUUID()),
		]);
		expect(view.signals.exhausted).toEqual({ groq: resetsAt });
		expect(view.signals.pausedFor).toBeUndefined();
	});
});
