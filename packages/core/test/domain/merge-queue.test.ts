import { err, ok, parseTemplate, VcsGitInputSchema } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { initialTransition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import {
	applyTask,
	approve,
	nextTeamStep,
	readyTasks,
	TeamStateSchema,
	teamOf,
	withoutWorktree,
} from "../../src/domain/team.js";
import { engineHarness } from "../helpers/engine.js";

const prepared = (withDependent = true) => {
	const template = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "writers", name: "Writers", version: "1.0.0" },
		pattern: "parallel_then_synthesize",
		roles: [
			{
				id: "writer",
				name: "Writer",
				goal: "Write",
				tier: "coder",
				capabilities: ["fs.write@1"],
			},
		],
		tasks: [
			{ id: "a", role: "writer", title: "A" },
			{ id: "b", role: "writer", title: "B" },
			...(withDependent
				? [{ id: "after", role: "writer", title: "After B", context: ["b"] }]
				: []),
		],
	});
	if (!template.ok) throw new Error("Invalid fixture");
	let team = teamOf(template.value);
	for (const id of ["a", "b"]) {
		team = applyTask(team, id, {
			type: "START",
			agentId: id,
			worktree: `/trees/${id}`,
		}).team;
		team = applyTask(team, id, { type: "SUBMIT", report: id }).team;
	}
	return team;
};

describe("approval-ordered merge queue", () => {
	it("lands reverse-template approvals in approval order and releases dependencies only after merge", () => {
		let team = approve(prepared(), "b", "system").team;
		team = approve(team, "a", "system").team;
		expect(team.mergeQueue).toEqual(["b", "a"]);
		expect(nextTeamStep(team)).toEqual({ kind: "merge", taskId: "b" });
		expect(readyTasks(team)).not.toContain("after");
		team = withoutWorktree(team, "b");
		expect(team.mergeQueue).toEqual(["a"]);
		expect(readyTasks(team)).toContain("after");
		expect(nextTeamStep(team)).toEqual({ kind: "merge", taskId: "a" });
	});
	it("retains queue position across roundtrip and retry without adding duplicates", () => {
		let team = approve(prepared(), "b", "system").team;
		team = approve(team, "a", "system").team;
		const loaded = TeamStateSchema.parse(JSON.parse(JSON.stringify(team)));
		expect(nextTeamStep(loaded)).toEqual({ kind: "merge", taskId: "b" });
		expect(approve(loaded, "b", "human").team.mergeQueue).toEqual(["b", "a"]);
		expect(loaded).toEqual(team);
	});
	it("keeps legacy pending work ahead of a newly approved writer", () => {
		const old = approve(prepared(), "b", "system").team;
		const { mergeQueue: _queue, ...legacy } = old;
		expect(TeamStateSchema.safeParse(legacy).success).toBe(true);
		const team = approve(legacy, "a", "system").team;
		expect(team.mergeQueue).toEqual(["b", "a"]);
	});
	it("rejects duplicate or unknown persisted queue ids", () => {
		const team = approve(prepared(), "b", "system").team;
		expect(
			TeamStateSchema.safeParse({ ...team, mergeQueue: ["b", "b"] }).success,
		).toBe(false);
		expect(
			TeamStateSchema.safeParse({ ...team, mergeQueue: ["missing"] }).success,
		).toBe(false);
	});
	it("keeps a failed head merge and its order in the real SQLite snapshot", async () => {
		const h = engineHarness({ scripts: [] });
		try {
			const team = approve(
				approve(prepared(), "b", "system").team,
				"a",
				"system",
			).team;
			const [initial] = initialTransition(runMachine, {
				goal: "write",
				priority: 1,
				messages: [],
			});
			const snapshot = runMachine.resolveState({
				value: "paused",
				context: { ...initial.context, team, pause: { reason: "approval" } },
			});
			const id = crypto.randomUUID();
			h.store.save(
				{
					id,
					workspaceId: crypto.randomUUID(),
					autonomyLevel: 2,
					budget: { cloudRequests: 10, maxHours: 1 },
					createdAt: new Date(0).toISOString(),
				},
				snapshot,
			);
			const restored = h.store.load(id)?.snapshot.context.team;
			if (!restored) throw new Error("Missing persisted team");
			expect(restored.mergeQueue).toEqual(["b", "a"]);
			expect(nextTeamStep(restored)).toEqual({ kind: "merge", taskId: "b" });
			expect(restored.tasks.b?.context.worktree).toBe("/trees/b");
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("retries a real merge failure first after recreating the engine, then lands the next approved task", async () => {
		const merged: string[] = [];
		let rejectMerge = true;
		const vcs = async (input: unknown) => {
			const op = VcsGitInputSchema.parse(input);
			if (op.op === "checkpoint.create")
				return ok({ op: op.op, ref: "checkpoint", sha: "sha" });
			if (op.op === "merge") {
				merged.push(op.taskId);
				if (rejectMerge)
					return err({ code: "conflict", message: "fixture conflict" });
			}
			return ok({ op: op.op });
		};
		const first = engineHarness({ scripts: [], tools: [["vcs.git@2", vcs]] });
		const team = approve(
			approve(prepared(false), "b", "system").team,
			"a",
			"system",
		).team;
		const [initial] = initialTransition(runMachine, {
			goal: "write",
			priority: 1,
			messages: [],
		});
		const snapshot = runMachine.resolveState({
			value: "paused",
			context: { ...initial.context, team, pause: { reason: "approval" } },
		});
		const id = crypto.randomUUID();
		first.store.save(
			{
				id,
				workspaceId: crypto.randomUUID(),
				autonomyLevel: 2,
				budget: { cloudRequests: 10, maxHours: 1 },
				createdAt: new Date(0).toISOString(),
			},
			snapshot,
		);
		try {
			expect((await first.engine.resume(id)).ok).toBe(true);
			await vi.waitFor(() =>
				expect(
					first.events.some((event) => event.type === "task.merge.failed"),
				).toBe(true),
			);
			expect(first.store.load(id)?.snapshot.context.team?.mergeQueue).toEqual([
				"b",
				"a",
			]);
		} finally {
			await first.stop();
		}
		rejectMerge = false;
		const second = engineHarness({
			scripts: [],
			db: first.db,
			tools: [["vcs.git@2", vcs]],
		});
		try {
			expect(
				(await second.engine.approve(id, { taskId: "b", decision: "approve" }))
					.ok,
			).toBe(true);
			await vi.waitFor(() =>
				expect(second.engine.status(id)).toMatchObject({
					ok: true,
					value: [{ status: "completed" }],
				}),
			);
			expect(merged).toEqual([
				team.tasks.b?.id,
				team.tasks.b?.id,
				team.tasks.a?.id,
			]);
			expect(second.store.load(id)?.snapshot.context.team?.mergeQueue).toEqual(
				[],
			);
		} finally {
			await second.stop();
			second.db.close();
		}
	});
});
