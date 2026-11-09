import { randomUUID } from "node:crypto";
import type { TeamTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import type { RunContext } from "../../src/domain/run-types.js";
import { seatContext, seatOwner } from "../../src/domain/skill-seat.js";
import type { RunSkillState } from "../../src/domain/skill-state.js";

const runId = randomUUID();
const taskId = randomUUID();
const template = {
	tasks: [{ id: "find", role: "finder", title: "Find" }],
} as unknown as TeamTemplate;
const team = (attempt?: string) =>
	({
		template,
		tasks: {
			find: {
				id: taskId,
				...(attempt ? { attempts: { id: attempt, finished: [] } } : {}),
			},
		},
	}) as unknown as RunContext["team"];
const skills = (contexts: RunSkillState["contexts"] = []): RunSkillState => ({
	runId,
	policy: { mode: "auto", roles: [] },
	contexts,
});
const ids = () => {
	let n = 0;
	return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

describe("skill seat ownership", () => {
	it("gives attempt 1 of a task an owner keyed by the task id", () => {
		const seat = seatOwner(
			{ team: team(), task: "find", skills: skills() },
			ids(),
		);
		expect(seat?.roleId).toBe("finder");
		expect(seat?.owner).toMatchObject({ runId, taskId, attemptId: taskId });
	});

	it("gives a fresh best-of-N attempt its own context, not the earlier one", () => {
		const first = {
			owner: { runId, contextId: randomUUID(), taskId, attemptId: taskId },
			roleId: "finder",
			snapshots: [],
		};
		const attempt = randomUUID();
		const seat = seatOwner(
			{ team: team(attempt), task: "find", skills: skills([first]) },
			ids(),
		);
		expect(seat?.owner.attemptId).toBe(attempt);
		expect(seat?.owner.contextId).not.toBe(first.owner.contextId);
	});

	it("reuses the same attempt's context across a model fallback or revision", () => {
		const existing = {
			owner: { runId, contextId: randomUUID(), taskId, attemptId: taskId },
			roleId: "finder",
			snapshots: [],
		};
		const c = { team: team(), task: "find", skills: skills([existing]) };
		expect(seatOwner(c, ids())?.owner).toEqual(existing.owner);
		expect(seatContext(c)).toBe(existing);
	});

	it.each([
		["reviewer", { review: "lead" }],
		["answerer", { clarify: "lead" }],
		["judge", { judge: true }],
	])("gives a %s no skill context", (_name, seat) => {
		expect(
			seatOwner(
				{ team: team(), task: "find", skills: skills(), ...seat },
				ids(),
			),
		).toBeUndefined();
	});

	it("gives a run without S2 state nothing", () => {
		expect(seatOwner({ team: team(), task: "find" }, ids())).toBeUndefined();
	});
});
