import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import {
	type TaskEvent,
	type TaskSnapshot,
	taskMachine,
} from "../../src/domain/task-machine.js";

const apply = (s: TaskSnapshot, ...events: TaskEvent[]) =>
	events.reduce((acc, e) => transition(taskMachine, acc, e)[0], s);

const fresh = (revisionLimit = 3) =>
	initialTransition(taskMachine, { revisionLimit })[0];

const start: TaskEvent = { type: "START", agentId: "a1" };
const submit: TaskEvent = { type: "SUBMIT", report: "done" };
const revise: TaskEvent = { type: "REVISE", feedback: "add sources" };

describe("task machine", () => {
	it("goes todo, in_progress, submitted, approved and stays approved", () => {
		const s = apply(fresh(), start, submit, { type: "APPROVE" }, revise);
		expect(s.value).toBe("approved");
		expect(s.status).toBe("done");
		expect(s.context).toMatchObject({ agentId: "a1", report: "done" });
	});

	it("counts revisions and keeps the feedback for the next attempt", () => {
		const s = apply(fresh(), start, submit, revise);
		expect(s.value).toBe("changes_requested");
		expect(s.context).toMatchObject({ revisions: 1, feedback: "add sources" });
		expect(apply(s, start).value).toBe("in_progress");
	});

	it("blocks instead of a revision past the limit", () => {
		const round = [start, submit, revise];
		const s = apply(fresh(2), ...round, ...round, start, submit, revise);
		expect(s.value).toBe("blocked");
		expect(s.context.revisions).toBe(2);
		expect(s.context.blocked).toBe("revision_limit");
	});

	it("blocks on the first revision when the limit is 0", () => {
		expect(apply(fresh(0), start, submit, revise).value).toBe("blocked");
	});

	it("blocks from in_progress and goes back to work when the human resolves it", () => {
		const s = apply(fresh(), start, {
			type: "BLOCK",
			reason: "clarification",
		});
		expect(s.value).toBe("blocked");
		expect(s.context.blocked).toBe("clarification");
		const back = apply(s, { type: "UNBLOCK", instruction: "use 2026 data" });
		expect(back.value).toBe("in_progress");
		expect(back.context).toMatchObject({ feedback: "use 2026 data" });
		expect(back.context.blocked).toBeUndefined();
	});

	it("ignores events the docs/07 table does not allow", () => {
		expect(apply(fresh(), submit, { type: "APPROVE" }).value).toBe("todo");
		expect(apply(fresh(), start, { type: "APPROVE" }).value).toBe(
			"in_progress",
		);
	});
});
