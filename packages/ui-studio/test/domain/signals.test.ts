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

	it("adds up how long the run was paused, each pause closed when the run goes on or ends (ADR-139)", () => {
		const at = (type: string, ts: string, payload: object = {}) => ({
			...event(type, payload),
			ts,
		});
		expect(EMPTY_TEAM_VIEW.signals.paused).toBe(0);
		const twice = applyAll(RUN, EMPTY_TEAM_VIEW, [
			at("run.started", "2026-10-23T10:00:00.000Z"),
			at("run.paused", "2026-10-23T10:01:00.000Z", { reason: "approval" }),
			at("run.resumed", "2026-10-23T10:39:00.000Z"),
			at("run.paused", "2026-10-23T10:40:00.000Z", { reason: "quota" }),
			at("run.cancelled", "2026-10-23T10:42:30.000Z"),
		]);
		expect(twice.signals.paused).toBe(40.5 * 60_000);
		expect(twice.signals.pausedSince).toBeUndefined();
		// A pause still open counts nothing yet and keeps when it began.
		const open = applyAll(RUN, EMPTY_TEAM_VIEW, [
			at("run.paused", "2026-10-23T10:01:00.000Z", { reason: "approval" }),
		]);
		expect(open.signals.paused).toBe(0);
		expect(open.signals.pausedSince).toBe("2026-10-23T10:01:00.000Z");
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

	it("records a policy ask when one arrives, stripping the rule", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("policy.asked", {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test",
				rule: "shell_allow",
			}),
		]);
		expect(view.signals.asked).toEqual({
			action: "shell.exec",
			capability: "shell.exec@1",
			adapterId: "tools",
			command: "npm test",
		});
	});

	it("replaces an earlier policy ask when a newer one arrives", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("policy.asked", {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test",
				rule: "shell_allow",
			}),
			event("policy.asked", {
				action: "git.push",
				capability: "vcs.git@2",
				adapterId: "tools",
				rule: "git_push",
			}),
		]);
		expect(view.signals.asked).toEqual({
			action: "git.push",
			capability: "vcs.git@2",
			adapterId: "tools",
		});
	});

	it("clears the policy ask when the run resumes or ends", () => {
		const asked = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("policy.asked", {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test",
				rule: "shell_allow",
			}),
		]);
		expect(asked.signals.asked).toBeDefined();
		const resumed = applyAll(RUN, asked, [event("run.resumed", {})]);
		expect(resumed.signals.asked).toBeUndefined();
		const ended = applyAll(RUN, asked, [
			event("run.completed", { summary: "done" }),
		]);
		expect(ended.signals.asked).toBeUndefined();
	});

	it("catches a policy ask that arrives after the run paused", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("run.paused", { reason: "approval" }),
			event("policy.asked", {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test",
				rule: "shell_allow",
			}),
		]);
		expect(view.signals.pausedFor).toBe("approval");
		expect(view.signals.asked).toEqual({
			action: "shell.exec",
			capability: "shell.exec@1",
			adapterId: "tools",
			command: "npm test",
		});
	});
});
