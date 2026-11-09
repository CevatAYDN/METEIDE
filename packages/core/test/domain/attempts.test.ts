import { parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	attemptIds,
	candidates,
	finishAttempt,
	goOn,
	leftBehind,
	withOpening,
} from "../../src/domain/attempts.js";
import {
	applyTask,
	nextTeamStep,
	type TeamState,
	TeamStateSchema,
	teamOf,
} from "../../src/domain/team.js";
import { withVerification } from "../../src/domain/verification.js";
import { checkedTeam } from "../helpers/checked-team.js";

// A best-of-N task's attempts as the run snapshot keeps them (ADR-162).

const team = (n: number): TeamState => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "best", name: "Best", version: "1.0.0" },
		pattern: "single",
		roles: [
			{
				id: "dev",
				name: "Dev",
				goal: "Build",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: [
			{
				id: "build",
				role: "dev",
				title: "Build",
				attempts: { n, distinct_families: false, judge_tier: "reasoning" },
			},
		],
	});
	if (!r.ok) throw new Error(r.error.issues.join("\n"));
	let id = 0;
	const fresh = teamOf(
		r.value,
		() => `00000000-0000-4000-8000-00000000000${id++}`,
	);
	const start = { type: "START", agentId: "a1", worktree: "/wt/1" } as const;
	return applyTask(fresh, "build", start).team;
};

const said = (content: string) => [{ role: "assistant" as const, content }];
const NEXT = "00000000-0000-4000-8000-000000000009";
const SESSION = {
	agent: {
		id: "00000000-0000-4000-8000-000000000001",
		providerId: "provider-a",
		modelId: "model-a",
	},
	turns: 2,
	checkpointed: 1,
	snapshot: "snapshots/run-a/1",
	tainted: true,
};

const withSession = (state: TeamState): TeamState => {
	const entry = state.tasks.build;
	if (!entry) throw new Error("task missing");
	return {
		...state,
		tasks: { ...state.tasks, build: { ...entry, session: SESSION } },
	};
};

describe("attempts in the run snapshot", () => {
	it("parses a snapshot from before attempts and one with them", () => {
		const before = team(2);
		expect(TeamStateSchema.parse(before)).toEqual(before);
		const after = finishAttempt(before, "build", { messages: said("x") }, NEXT);
		expect(TeamStateSchema.parse(after)).toEqual(after);
	});

	it("starts the next attempt with no agent, no worktree and the opening, so the team starts it", () => {
		const opening = [{ role: "user" as const, content: "Answers: Ankara" }];
		const opened = withOpening(team(2), "build", opening);
		const next = finishAttempt(opened, "build", { messages: said("x") }, NEXT);
		const entry = next.tasks.build;
		expect(entry?.status).toBe("in_progress");
		expect(entry?.context.agentId).toBeUndefined();
		expect(entry?.context.worktree).toBeUndefined();
		expect(entry?.messages).toEqual(opening);
		expect(entry?.attempts?.id).toBe(NEXT);
		expect(nextTeamStep(next)).toEqual({ kind: "start", taskId: "build" });
		const restarted = finishAttempt(
			withSession(next),
			"build",
			{ messages: said("x") },
			NEXT,
		);
		expect(restarted.tasks.build?.session).toEqual({
			turns: 0,
			checkpointed: -1,
			tainted: false,
		});
	});

	it("records no opening for a task without attempts", () => {
		const one = team(1);
		expect(withOpening(one, "build", said("x"))).toBe(one);
	});

	it("lets an earlier attempt go on with its own agent, worktree, words and id", () => {
		const first = finishAttempt(
			team(2),
			"build",
			{ messages: said("report 1"), report: "report 1" },
			NEXT,
		);
		const started = applyTask(first, "build", {
			type: "ATTEMPT",
			agentId: "a2",
			worktree: "/wt/2",
		}).team;
		const both = finishAttempt(started, "build", { messages: said("notes") });
		expect(candidates(both, "build")).toEqual([1]);
		const went = goOn(both, "build", 1);
		const entry = went.tasks.build;
		expect(entry?.context).toMatchObject({
			agentId: "a1",
			worktree: "/wt/1",
			report: "report 1",
		});
		expect(entry?.messages).toEqual(said("report 1"));
		// The first attempt is named by the task's own id.
		expect(entry?.attempts?.id).toBeUndefined();
		expect(leftBehind(went, "build")).toEqual([NEXT]);
		expect(entry && attemptIds(entry)).toEqual([entry?.id, NEXT]);
	});

	it("keeps the chosen attempt's session when it goes on", () => {
		const first = finishAttempt(
			withSession(team(2)),
			"build",
			{ messages: said("report 1"), report: "report 1" },
			NEXT,
		);
		const second = applyTask(first, "build", {
			type: "ATTEMPT",
			agentId: "a2",
			worktree: "/wt/2",
		}).team;
		const both = finishAttempt(withSession(second), "build", {
			messages: said("report 2"),
			report: "report 2",
		});
		const chosen = goOn(both, "build", 1);
		expect(chosen.tasks.build?.session).toEqual(SESSION);
		expect(TeamStateSchema.parse(chosen)).toEqual(chosen);
	});
});

const requiredTeam = () => {
	const base = team(2);
	return {
		...base,
		template: {
			...base.template,
			tasks: base.template.tasks.map((task) => ({
				...task,
				verify: [{ run: "check" }],
			})),
		},
	};
};

describe("strict best-of-N evidence", () => {
	it("records, clears and restores each attempt's own evaluation", () => {
		const original = checkedTeam(requiredTeam(), "build", "first");
		const first = finishAttempt(
			original,
			"build",
			{ report: "first", messages: said("first") },
			NEXT,
		);
		expect(first.tasks.build?.verification).toBeUndefined();
		expect(first.tasks.build?.attempts?.finished[0]?.verification).toEqual(
			original.tasks.build?.verification,
		);
		const all = finishAttempt(first, "build", {
			report: "unverified",
			messages: said("unverified"),
		});
		expect(candidates(all, "build")).toEqual([1]);
		expect(goOn(all, "build", 2).tasks.build?.attempts?.goesOn).toBeUndefined();
		const chosen = goOn(all, "build", 1);
		expect(chosen.tasks.build?.verification).toEqual(
			original.tasks.build?.verification,
		);
	});
	it("does not select report-only or wrong-report candidates", () => {
		const unverified = finishAttempt(
			requiredTeam(),
			"build",
			{ report: "first", messages: said("first") },
			NEXT,
		);
		const changed = finishAttempt(
			checkedTeam(unverified, "build", "second"),
			"build",
			{
				report: "different",
				messages: said("different"),
			},
		);
		expect(candidates(changed, "build")).toEqual([]);
	});
	it("cannot reuse a recorded pass after the same attempt has newer failing evidence", () => {
		const first = checkedTeam(requiredTeam(), "build", "first");
		const all = finishAttempt(first, "build", {
			report: "first",
			messages: said("first"),
		});
		const passed = all.tasks.build?.verification;
		if (!passed) throw new Error("evidence missing");
		const newer = withVerification(all, "build", {
			...passed,
			evaluationId: crypto.randomUUID(),
			gates: [
				{
					index: 0,
					gate: "check",
					optional: false,
					status: "failed",
					details: "failed",
				},
			],
		});
		expect(candidates(newer, "build")).toEqual([]);
		expect(
			goOn(newer, "build", 1).tasks.build?.attempts?.goesOn,
		).toBeUndefined();
	});
});
