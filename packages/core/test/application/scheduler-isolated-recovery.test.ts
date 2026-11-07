import { ok } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTERRUPTED } from "../../src/application/recovery.js";
import { runMachine } from "../../src/domain/run-machine.js";
import { freshTaskSession } from "../../src/domain/task-session-schema.js";
import type { TeamState } from "../../src/domain/team.js";
import { engineHarness, reply } from "../helpers/engine.js";
import {
	gatedReply,
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilRequests,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
let later: ReturnType<typeof engineHarness> | undefined;
afterEach(async () => {
	await later?.stop();
	await held?.cleanup();
	later = undefined;
	held = undefined;
});

const crashTask = (
	id: string,
	task: TeamState["tasks"][string],
	status: "in_progress" | "blocked",
) => ({
	...task,
	status: id === "b" ? status : task.status,
	messages: [
		...task.messages,
		{
			role: "assistant" as const,
			content: "",
			toolCalls: [
				{
					id: "same-call",
					name: "fs_write",
					args: { path: `${id}.txt`, content: id },
				},
			],
		},
	],
	session: {
		...freshTaskSession(),
		...task.session,
		checkpointed: task.messages.length,
		inFlight: "same-call",
	},
});

const expectRecovered = (h: SchedulerHarness) => {
	const recovered = stateOf(h)?.context;
	expect(recovered?.inFlight).toBeUndefined();
	for (const task of ["a", "b"]) {
		const entry = recovered?.team?.tasks[task];
		expect(entry?.session?.inFlight).toBeUndefined();
		expect(entry?.messages.filter((m) => m.role === "tool")).toEqual([
			{ role: "tool", toolCallId: "same-call", content: INTERRUPTED },
		]);
	}
};

describe("recovery of every task-local writing marker", () => {
	it.each([
		{ value: "running", status: "in_progress" },
		{ value: "paused", status: "in_progress" },
		{ value: "paused", status: "blocked" },
	] as const)(
		"settles both $value task sessions, including $status, with reused call ids and no replay",
		async ({ value, status }) => {
			const models = [gatedReply("old-a"), gatedReply("old-b")];
			held = await schedulerHarness({
				scripts: models.map((m) => m.script),
				rewrite: (source) =>
					source
						.replace("  - { id: c, role: first, title: Task C }\n", "")
						.replace(
							"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
							"",
						),
			});
			const h = held;
			await untilRequests(h, 2);
			await h.engine.pause(h.runId);
			await h.stop();
			for (const model of models) model.release();
			const row = h.store.load(h.runId);
			const context = row?.snapshot.context;
			if (!row || !context?.team) throw new Error("missing durable team");
			const tasks = Object.fromEntries(
				Object.entries(context.team.tasks).map(([id, task]) => [
					id,
					crashTask(id, task, status),
				]),
			);
			const seat = tasks.a;
			if (!seat) throw new Error("missing active task");
			h.store.save(
				row.meta,
				runMachine.resolveState({
					value,
					context: {
						...context,
						task: "a",
						messages: seat.messages,
						agent: seat.session.agent,
						inFlight: "same-call",
						team: {
							...context.team,
							tasks,
							template: {
								...context.team.template,
								roles: context.team.template.roles.map((role) => ({
									...role,
									capabilities: ["fs.write@1"] as const,
								})),
							},
						},
					},
				}),
			);
			let replayed = 0;
			later = engineHarness({
				db: h.db,
				templates: h.templates,
				scripts: [reply("done")],
				tools: [
					[
						"fs.write@1",
						async () => {
							replayed++;
							return ok({ bytes: 1 });
						},
					],
				],
			});
			later.recover();
			later.recover();
			expectRecovered(h);
			const recovered = stateOf(h)?.context;
			expect(recovered?.pause?.reason).toBe("user");
			expect(recovered?.team?.tasks.b?.status).toBe(status);
			expect((await later.engine.resume(h.runId)).ok).toBe(true);
			await vi.waitFor(() =>
				expect(stateOf(h)?.value).toBe(
					status === "blocked" ? "paused" : "completed",
				),
			);
			expect(replayed).toBe(0);
			for (const task of ["a", "b"])
				expect(
					stateOf(h)?.context.team?.tasks[task]?.messages.filter(
						(m) => m.role === "tool",
					),
				).toHaveLength(1);
		},
	);
});
