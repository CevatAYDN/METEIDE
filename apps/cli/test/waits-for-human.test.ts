import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { waitsForHuman } from "../src/domain/format.js";

// Which answer a team run's pause for approval needs (docs/08): `mete approve` while a task waits
// for the human, resume for a policy ask. Hand-written events in the catalog's shapes.

const TASK = crypto.randomUUID();

const event = (type: string, payload: object): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: new Date().toISOString(),
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: crypto.randomUUID(),
		taskId: TASK,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const asked = (approver: string) => event("approval.requested", { approver });
const resolved = (approver: string) =>
	event("approval.resolved", { approver, decision: "approve" });
const moved = (from: string, to: string) =>
	event("task.status.changed", { from, to });
const mergeFailed = event("task.merge.failed", {
	code: "merge_conflict",
	message: "conflict",
	branch: "mete/r/t",
});
const resumed = event("run.resumed", {});

describe("waitsForHuman", () => {
	it("waits from the human's approval request until the human decides", () => {
		expect(waitsForHuman([asked("human")])).toBe(true);
		expect(waitsForHuman([asked("human"), resolved("human")])).toBe(false);
	});

	it("does not wait on an approver role", () => {
		expect(waitsForHuman([asked("lead")])).toBe(false);
	});

	it("waits while a task is blocked", () => {
		expect(waitsForHuman([moved("in_progress", "blocked")])).toBe(true);
		expect(
			waitsForHuman([
				moved("in_progress", "blocked"),
				moved("blocked", "in_progress"),
			]),
		).toBe(false);
	});

	it("keeps the human's approval mark through other status changes", () => {
		expect(
			waitsForHuman([asked("human"), moved("submitted", "submitted")]),
		).toBe(true);
	});

	it("waits on a failed merge until the run resumes and tries it again", () => {
		expect(waitsForHuman([mergeFailed])).toBe(true);
		expect(waitsForHuman([mergeFailed, resumed])).toBe(false);
		expect(waitsForHuman([mergeFailed, resumed, mergeFailed])).toBe(true);
	});

	it("does not wait for a run with no task events, such as a policy ask", () => {
		expect(waitsForHuman([event("run.started", {}), resumed])).toBe(false);
	});
});
