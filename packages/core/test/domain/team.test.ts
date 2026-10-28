import { parseTemplate, type TeamTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	applyTask,
	approve,
	nextTeamStep,
	setRepairs,
	type TeamState,
	TeamStateSchema,
	teamOf,
	withLesson,
} from "../../src/domain/team.js";

const role = (id: string) => ({
	id,
	name: id,
	goal: `be ${id}`,
	tier: "fast",
	capabilities: [],
});

// The research shape: two researchers, a synthesizer that reads both, a lead that approves.
const research = (human = false): TeamTemplate => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "research", name: "Research", version: "1.0.0" },
		pattern: "parallel_then_synthesize",
		roles: ["researcher", "synthesizer", "lead"].map(role),
		tasks: [
			{ id: "a", role: "researcher", title: "A" },
			{ id: "b", role: "researcher", title: "B" },
			{
				id: "report",
				role: "synthesizer",
				title: "Report",
				context: ["a", "b"],
				approval: "lead",
			},
		],
		policies: human ? { human_checkpoints: ["report"] } : {},
	});
	if (!r.ok) throw new Error(r.error.issues.join("\n"));
	return r.value;
};

// The research shape with an editor reviewing the report before the lead (ADR-136).
const paired = (turns: number): TeamTemplate => {
	const t = research();
	const r = parseTemplate({
		...t,
		roles: [...t.roles, role("editor")],
		tasks: t.tasks.map((x) =>
			x.id === "report"
				? { ...x, review: { pair_with: "editor", max_turns: turns } }
				: x,
		),
	});
	if (!r.ok) throw new Error(r.error.issues.join("\n"));
	return r.value;
};

const run = (
	t: TeamState,
	id: string,
	...events: Parameters<typeof applyTask>[2][]
) => events.reduce((acc, e) => applyTask(acc, id, e).team, t);

const done = (t: TeamState, id: string) =>
	run(t, id, { type: "START", agentId: id }, { type: "SUBMIT", report: id });

describe("team state", () => {
	it("starts the first ready task in template order", () => {
		expect(nextTeamStep(teamOf(research()))).toEqual({
			kind: "start",
			taskId: "a",
		});
	});

	it("keeps working on a task in progress", () => {
		const t = run(teamOf(research()), "a", { type: "START", agentId: "x" });
		expect(nextTeamStep(t)).toEqual({ kind: "work", taskId: "a" });
	});

	it("accepts a submission that needs no approver", () => {
		const t = done(teamOf(research()), "a");
		expect(nextTeamStep(t)).toEqual({ kind: "accept", taskId: "a" });
	});

	it("starts a task only when every context task is approved", () => {
		let t = teamOf(research());
		t = approve(done(t, "a"), "a", "system").team;
		expect(nextTeamStep(t)).toEqual({ kind: "start", taskId: "b" });
		t = approve(done(t, "b"), "b", "system").team;
		expect(nextTeamStep(t)).toEqual({ kind: "start", taskId: "report" });
	});

	it("asks the approver role, then the human of a checkpoint, then completes", () => {
		let t = teamOf(research(true));
		for (const id of ["a", "b"]) t = approve(done(t, id), id, "system").team;
		t = done(t, "report");
		expect(nextTeamStep(t)).toEqual({
			kind: "approve",
			taskId: "report",
			by: "lead",
		});
		t = approve(t, "report", "lead").team;
		expect(t.tasks.report?.status).toBe("submitted");
		expect(nextTeamStep(t)).toEqual({ kind: "wait", taskIds: ["report"] });
		const last = approve(t, "report", "human");
		expect(last.change).toEqual({ from: "submitted", to: "approved" });
		expect(nextTeamStep(last.team)).toEqual({ kind: "complete" });
	});

	it("forgets earlier approvals when a revision is asked", () => {
		let t = teamOf(research(true));
		for (const id of ["a", "b"]) t = approve(done(t, id), id, "system").team;
		t = approve(done(t, "report"), "report", "lead").team;
		t = run(t, "report", { type: "REVISE", feedback: "more" });
		expect(t.tasks.report?.approvals).toEqual([]);
		expect(nextTeamStep(t)).toEqual({ kind: "start", taskId: "report" });
	});

	it("asks the pair before the lead; its returns do not count and end after max_turns (ADR-136)", () => {
		let t = teamOf(paired(1));
		for (const id of ["a", "b"]) t = approve(done(t, id), id, "system").team;
		t = done(t, "report");
		const editor = { kind: "approve", taskId: "report", by: "editor" };
		expect(nextTeamStep(t)).toEqual(editor);
		t = run(t, "report", { type: "PAIR_REVISE", feedback: "fix it" });
		expect(t.tasks.report?.context).toMatchObject({
			revisions: 0,
			pairTurns: 1,
			feedback: "fix it",
		});
		t = done(t, "report");
		expect(nextTeamStep(t)).toEqual({ ...editor, by: "lead" });
	});

	it("asks the pair again after the lead's revision while it has turns (ADR-136)", () => {
		let t = teamOf(paired(4));
		for (const id of ["a", "b"]) t = approve(done(t, id), id, "system").team;
		t = approve(done(t, "report"), "report", "editor").team;
		const lead = { kind: "approve", taskId: "report", by: "lead" };
		expect(nextTeamStep(t)).toEqual(lead);
		t = done(run(t, "report", { type: "REVISE", feedback: "more" }), "report");
		expect(nextTeamStep(t)).toEqual({ ...lead, by: "editor" });
		expect(t.tasks.report?.context.revisions).toBe(1);
	});

	it("waits when every open task is blocked", () => {
		const t = run(
			teamOf(research()),
			"a",
			{ type: "START", agentId: "x" },
			{ type: "BLOCK", reason: "guardrail" },
		);
		const b = run(
			t,
			"b",
			{ type: "START", agentId: "y" },
			{
				type: "BLOCK",
				reason: "guardrail",
			},
		);
		expect(nextTeamStep(b)).toEqual({ kind: "wait", taskIds: ["a", "b"] });
	});

	it("reports a status change and none for an event the task ignores", () => {
		const t = teamOf(research());
		expect(applyTask(t, "a", { type: "START", agentId: "x" }).change).toEqual({
			from: "todo",
			to: "in_progress",
		});
		expect(applyTask(t, "a", { type: "APPROVE" }).change).toBeUndefined();
	});

	it("counts guardrail repairs per attempt", () => {
		const t = run(teamOf(research()), "a", { type: "START", agentId: "x" });
		const repaired = setRepairs(t, "a", 2);
		expect(repaired.tasks.a?.repairs).toBe(2);
		const submitted = run(repaired, "a", { type: "SUBMIT", report: "r" });
		expect(submitted.tasks.a?.repairs).toBe(0);
	});

	// docs/08, step 8: an approved task's lesson comes before the next task, and is asked once.
	it("asks an approved task's lesson before going on, once", () => {
		const t0 = research();
		const tasks = t0.tasks.map((x) =>
			x.id === "a" ? { ...x, memory: { write_lessons: true } } : x,
		);
		let t = teamOf({ ...t0, tasks });
		t = approve(done(t, "a"), "a", "system").team;
		expect(nextTeamStep(t)).toEqual({ kind: "lesson", taskId: "a" });
		t = withLesson(t, "a", "skipped");
		expect(nextTeamStep(t)).toEqual({ kind: "start", taskId: "b" });
		expect(TeamStateSchema.parse(JSON.parse(JSON.stringify(t)))).toEqual(t);
	});

	it("survives a JSON round trip through its schema", () => {
		const t = done(teamOf(research(true)), "a");
		const back = TeamStateSchema.parse(JSON.parse(JSON.stringify(t)));
		expect(back).toEqual(t);
	});
});
