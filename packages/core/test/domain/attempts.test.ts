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
});
