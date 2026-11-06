import { parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import { MAX_TURNS } from "../../src/defaults.js";
import { nextStep } from "../../src/domain/next-step.js";
import { type RunContext, runMachine } from "../../src/domain/run-machine.js";
import { syncSeatedWorker, taskContext } from "../../src/domain/task-worker.js";
import { applyTask, readyTasks, teamOf } from "../../src/domain/team.js";
import { conversationsOf } from "../../src/domain/transcript.js";
import { loadSnapshot } from "../../src/infrastructure/run-store.js";

const setup = () => {
	const parsed = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "legacy", name: "Legacy", version: "1.0.0" },
		pattern: "pipeline",
		roles: [
			{
				id: "reader",
				name: "Reader",
				goal: "Read",
				tier: "fast",
				capabilities: [],
			},
		],
		tasks: [
			{ id: "a", role: "reader", title: "A" },
			{ id: "b", role: "reader", title: "B", context: ["a"] },
		],
	});
	if (!parsed.ok) throw new Error("invalid fixture");
	const team = applyTask(teamOf(parsed.value), "a", {
		type: "START",
		agentId: "agent-a",
	}).team;
	const context = initialTransition(runMachine, {
		goal: "read",
		priority: 1,
		messages: [],
	})[0].context;
	const messages = [
		{ role: "system" as const, content: "system" },
		{ role: "user" as const, content: "task" },
		{ role: "assistant" as const, content: "worker" },
	];
	return { team, context, messages };
};

const headSeat = (): RunContext => {
	const { team, context, messages } = setup();
	return {
		...context,
		reservations: undefined,
		team,
		task: "a",
		messages: [
			...messages,
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{ id: "read", name: "fs_read", args: { path: "external.txt" } },
				],
			},
			{ role: "tool", toolCallId: "read", content: "external source evidence" },
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "pending-write",
						name: "fs_write",
						args: { path: "a.txt", content: "a" },
					},
				],
			},
		],
		agent: { id: "agent-a", roleId: "reader", providerId: "p", modelId: "m" },
		turns: 3,
		requests: 3,
		tainted: true,
		checkpointed: 5,
		snapshot: "snapshots/legacy/5",
		inFlight: "pending-write",
	};
};

const loadSeat = (context: RunContext) =>
	loadSnapshot(
		JSON.stringify(
			runMachine.getPersistedSnapshot(
				runMachine.resolveState({ value: "paused", context }),
			),
		),
	);

describe("scheduler snapshot compatibility", () => {
	it.each(["user", "no_model"] as const)(
		"retains a legacy first-call opening paused for %s before any model agent exists",
		(reason) => {
			const { team, context, messages } = setup();
			const opening = messages.slice(0, 2);
			const loaded = loadSeat({
				...context,
				reservations: undefined,
				team,
				task: "a",
				messages: opening,
				agent: undefined,
				tainted: true,
				pause: { reason },
			});
			expect(loaded.context.team?.tasks.a?.messages).toEqual(opening);
			const resumed = transition(runMachine, loaded, {
				type: "RESUME",
				at: 2,
			})[0];
			const worker = taskContext(resumed.context, "a");
			expect(worker).toMatchObject({
				messages: opening,
				agent: undefined,
				turns: 0,
				requests: 0,
				tainted: true,
				checkpointed: -1,
			});
			if (!worker) throw new Error("missing worker");
			expect(nextStep(worker, { cloudRequests: 10, maxHours: 1 }, 2)).toEqual({
				kind: "model",
			});
		},
	);

	it("does not treat an unassigned next attempt as a legacy first call", () => {
		const head = headSeat();
		const entry = head.team?.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		entry.context.agentId = undefined;
		const loaded = loadSeat({ ...head, agent: undefined });
		expect(loaded.context.team?.tasks.a?.messages).toEqual([]);
		expect(loaded.context.team?.tasks.a?.session).toEqual({
			turns: 0,
			checkpointed: -1,
			tainted: false,
		});
	});

	it("migrates the actual pre-scheduler HEAD seat despite START's existing fresh session", () => {
		const head = headSeat();
		expect(head.team?.tasks.a?.session).toEqual({
			turns: 0,
			checkpointed: -1,
			tainted: false,
		});
		const loaded = loadSeat(head);
		const expected = {
			messages: head.messages,
			agent: head.agent,
			turns: 3,
			requests: 3,
			tainted: true,
			checkpointed: 5,
			snapshot: "snapshots/legacy/5",
			inFlight: "pending-write",
		};
		expect(taskContext(loaded.context, "a")).toMatchObject(expected);
		expect(JSON.stringify(conversationsOf(loaded.context))).toContain(
			"external source evidence",
		);
		expect(loaded.context.reservations).toEqual([]);
		const resumed = transition(runMachine, loaded, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(taskContext(resumed.context, "a")).toMatchObject(expected);
		const reloaded = loadSeat(resumed.context);
		expect(taskContext(reloaded.context, "a")).toMatchObject(expected);
	});

	it.each([
		{ agentId: undefined, session: true },
		{ agentId: "next-agent", session: true },
		{ agentId: undefined, session: false },
		{ agentId: "next-agent", session: false },
	])(
		"does not migrate a finished root agent into a different attempt %j",
		({ agentId, session }) => {
			const head = headSeat();
			const entry = head.team?.tasks.a;
			if (!entry) throw new Error("missing fixture task");
			entry.context.agentId = agentId;
			if (!session) delete entry.session;
			const loaded = loadSeat(head);
			const resumed = transition(runMachine, loaded, {
				type: "RESUME",
				at: 2,
			})[0];
			expect(taskContext(resumed.context, "a")).toMatchObject({
				messages: [],
				turns: 0,
				tainted: false,
				checkpointed: -1,
				agent: undefined,
				inFlight: undefined,
				snapshot: undefined,
			});
		},
	);

	it.each([{ review: "reader" }, { clarify: "reader" }, { judge: true }])(
		"does not migrate a pre-scheduler coordinator seat %j",
		(flags) => {
			const loaded = loadSeat({ ...headSeat(), ...flags });
			expect(loaded.context.team?.tasks.a?.messages).toEqual([]);
			expect(loaded.context.team?.tasks.a?.session).toEqual({
				turns: 0,
				checkpointed: -1,
				tainted: false,
			});
		},
	);

	it.each([true, false])(
		"never remigrates a scheduler-generation row over its empty task, session=%s",
		(session) => {
			const head = headSeat();
			const entry = head.team?.tasks.a;
			if (!entry) throw new Error("missing fixture task");
			if (!session) delete entry.session;
			const loaded = loadSeat({ ...head, reservations: [] });
			expect(JSON.stringify(conversationsOf(loaded.context))).not.toContain(
				"external source evidence",
			);
			const resumed = transition(runMachine, loaded, {
				type: "RESUME",
				at: 2,
			})[0];
			expect(taskContext(resumed.context, "a")).toMatchObject({
				messages: [],
				turns: 0,
				tainted: false,
				agent: undefined,
				inFlight: undefined,
			});
		},
	);

	it("clears a pre-scheduler policy refusal marker but retains the pending approved write", () => {
		const head = { ...headSeat(), pause: { reason: "approval" as const } };
		const loaded = loadSeat(head);
		expect(loaded.context.inFlight).toBeUndefined();
		expect(loaded.context.team?.tasks.a?.session?.inFlight).toBeUndefined();
		expect(loaded.context.team?.tasks.a?.messages).toEqual(head.messages);
		const resumed = transition(runMachine, loaded, {
			type: "RESUME",
			at: 2,
		})[0];
		const worker = taskContext(resumed.context, "a");
		if (!worker) throw new Error("missing worker");
		expect(
			nextStep(worker, { cloudRequests: 10, maxHours: 1 }, 2),
		).toMatchObject({
			kind: "tool",
			call: { id: "pending-write", name: "fs_write" },
			checkpoint: false,
		});
	});

	it("does not clear a pre-scheduler uncertain user-paused write or infer refusal for a newer row", () => {
		for (const context of [
			{ ...headSeat(), pause: { reason: "user" as const } },
			{
				...headSeat(),
				reservations: [],
				pause: { reason: "approval" as const },
			},
		])
			expect(loadSeat(context).context.inFlight).toBe("pending-write");
	});

	it("does not restore the previous seat over an explicitly fresh empty attempt on resume", () => {
		const { team, context, messages } = setup();
		const paused = runMachine.resolveState({
			value: "paused",
			context: {
				...context,
				team,
				task: "a",
				messages,
				turns: 3,
				inFlight: "old-write",
			},
		});
		const resumed = transition(runMachine, paused, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(taskContext(resumed.context, "a")).toMatchObject({
			messages: [],
			turns: 0,
			inFlight: undefined,
			checkpointed: -1,
		});
	});

	it("synchronizes the asking worker but never copies answerer or buffered worker seats", () => {
		const { team, context, messages } = setup();
		const entry = team.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		entry.context.clarify = "asking";
		const run = { ...context, team, task: "a", messages, turns: 1 };
		const event = { type: "TOOL_STARTED", callId: "write" } as const;
		expect(syncSeatedWorker(run, event).team?.tasks.a?.messages).toEqual(
			messages,
		);
		const answering = { ...run, clarify: "reader" };
		expect(syncSeatedWorker(answering, event)).toBe(answering);
		const worker = {
			type: "WORKER",
			task: "a",
			messages: [],
			session: { turns: 0, tainted: false, checkpointed: -1 },
			requests: 0,
		} as const;
		expect(syncSeatedWorker(run, worker)).toBe(run);
	});

	it("keeps the human's newly seated instruction when resume restores worker sessions", () => {
		const { team, context, messages } = setup();
		const entry = team.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		entry.messages = messages;
		const paused = runMachine.resolveState({
			value: "paused",
			context: { ...context, team },
		});
		const instructed = [
			...messages,
			{ role: "user" as const, content: "Human: use the new source" },
		];
		const seated = transition(runMachine, paused, {
			type: "SWITCH",
			task: "a",
			team,
			messages: instructed,
			state: { turns: 0, tainted: true },
		})[0];
		const resumed = transition(runMachine, seated, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(taskContext(resumed.context, "a")).toMatchObject({
			messages: instructed,
			tainted: true,
			turns: 0,
		});
	});
	it("recovers a legacy active conversation, agent, taint and checkpoints into the task's session", () => {
		const { team, context, messages } = setup();
		const entry = team.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		delete entry.session;
		const agent = {
			id: "agent-a",
			roleId: "reader",
			providerId: "p",
			modelId: "m",
		};
		const saved = runMachine.resolveState({
			value: "paused",
			context: {
				...context,
				reservations: undefined,
				team,
				task: "a",
				messages,
				agent,
				turns: 3,
				requests: 3,
				checkpointed: 2,
				tainted: true,
			},
		});
		const loaded = loadSnapshot(
			JSON.stringify(runMachine.getPersistedSnapshot(saved)),
		);
		const resumed = transition(runMachine, loaded, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(taskContext(resumed.context, "a")).toMatchObject({
			messages,
			agent,
			turns: 3,
			checkpointed: 2,
			tainted: true,
			requests: 3,
		});
	});

	it("resets only exhausted worker turn limits on resume, without losing agents or messages", () => {
		const { team, context, messages } = setup();
		const entry = team.tasks.a;
		if (!entry?.session) throw new Error("missing fixture session");
		entry.messages = messages;
		entry.session = { ...entry.session, turns: MAX_TURNS, tainted: true };
		const paused = runMachine.resolveState({
			value: "paused",
			context: { ...context, team },
		});
		const resumed = transition(runMachine, paused, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(taskContext(resumed.context, "a")).toMatchObject({
			turns: 0,
			tainted: true,
			messages,
		});
		expect(resumed.context.team?.tasks.b?.session).toBeUndefined();
	});

	it("does not start dependents until approved work has landed", () => {
		const { team } = setup();
		const submitted = applyTask(team, "a", {
			type: "SUBMIT",
			report: "done",
		}).team;
		const approved = applyTask(submitted, "a", { type: "APPROVE" }).team;
		const entry = approved.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		entry.context = { ...entry.context, worktree: "/pending-merge" };
		expect(readyTasks(approved)).toEqual([]);
		entry.context = { ...entry.context, worktree: undefined };
		expect(readyTasks(approved)).toEqual(["b"]);
	});

	it("reads the persisted worker transcript instead of a stale coordinator seat", () => {
		const { team, context, messages } = setup();
		const entry = team.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		entry.messages = messages;
		const conversations = conversationsOf({
			...context,
			team,
			task: "a",
			messages: [],
		});
		expect(conversations[0]?.steps).toEqual([
			{ text: "worker", toolCalls: [] },
		]);
	});
});
