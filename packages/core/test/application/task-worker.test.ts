import { parseTemplate } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { initialTransition, transition } from "xstate";
import type { EngineState, Live } from "../../src/application/run-state.js";
import { applyWorker } from "../../src/application/task-worker.js";
import { runMachine } from "../../src/domain/run-machine.js";
import { taskContext } from "../../src/domain/task-worker.js";
import { applyTask, teamOf } from "../../src/domain/team.js";
import { loadSnapshot } from "../../src/infrastructure/run-store.js";

const setup = () => {
	const template = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "workers", name: "Workers", version: "1.0.0" },
		pattern: "parallel_then_synthesize",
		roles: [
			{
				id: "reader",
				name: "Reader",
				goal: "Read",
				tier: "fast",
				capabilities: [],
			},
		],
		tasks: ["a", "b"].map((id) => ({ id, role: "reader", title: id })),
	});
	if (!template.ok) throw new Error(template.error.issues.join("\n"));
	let team = teamOf(template.value);
	for (const id of ["a", "b"])
		team = applyTask(team, id, { type: "START", agentId: `agent-${id}` }).team;
	let snapshot = initialTransition(runMachine, {
		goal: "Research",
		priority: 1,
		messages: [{ role: "user", content: "Coordinator" }],
	})[0];
	for (const event of [
		{ type: "START", at: 0 },
		{ type: "TEAM", team },
	] as const)
		snapshot = transition(runMachine, snapshot, event)[0];
	const live: Live = {
		meta: {
			id: "run",
			workspaceId: "workspace",
			budget: { cloudRequests: 10, maxHours: 1 },
			autonomyLevel: 2,
			createdAt: "2026-11-06T00:00:00.000Z",
		},
		snapshot,
		token: {},
		loop: Promise.resolve(),
		all: new AbortController(),
	};
	const save = vi.fn();
	const state = {
		deps: {
			store: {
				save,
				load: () => ({ meta: live.meta, snapshot: live.snapshot }),
			},
		},
	} as unknown as EngineState;
	return { live, state, save };
};

describe("task-local worker progress", () => {
	it("refuses progress without saving when its persisted state cannot be read", () => {
		const { live, state, save } = setup();
		vi.spyOn(state.deps.store, "load").mockImplementation(() => {
			throw new Error("read failed");
		});
		const before = live.snapshot;
		expect(applyWorker(state, live, "a", { type: "TAINT" })).toBe(false);
		expect(live.snapshot).toBe(before);
		expect(save).not.toHaveBeenCalled();
	});
	it("persists metadata taint in only the exposed worker before any reply", () => {
		const { live, state } = setup();
		expect(applyWorker(state, live, "a", { type: "TAINT" })).toBe(true);
		const saved = loadSnapshot(
			JSON.stringify(runMachine.getPersistedSnapshot(live.snapshot)),
		);
		expect(taskContext(saved.context, "a")?.tainted).toBe(true);
		expect(taskContext(saved.context, "b")?.tainted).toBe(false);
		expect(saved.context.tainted).toBeUndefined();
		expect(saved.context.requests).toBe(0);
	});

	it("isolates agents, messages, turns, taint and checkpoints while sharing request accounting", () => {
		const { live, state, save } = setup();
		const coordinator = live.snapshot.context;
		for (const id of ["a", "b"]) {
			applyWorker(state, live, id, {
				type: "MODEL",
				agent: {
					id: `agent-${id}`,
					roleId: "reader",
					providerId: "p",
					modelId: id,
				},
			});
			applyWorker(state, live, id, {
				type: "REPLIED",
				message: { role: "assistant", content: id },
				finish: id === "a" ? "length" : "stop",
			});
		}
		applyWorker(state, live, "a", {
			type: "CHECKPOINTED",
			step: 0,
			snapshot: "snapshot-a",
		});
		applyWorker(state, live, "a", {
			type: "TOOL_DONE",
			message: { role: "tool", toolCallId: "call-a", content: "external" },
			external: true,
		});
		const a = taskContext(live.snapshot.context, "a");
		const b = taskContext(live.snapshot.context, "b");
		expect(a?.agent).toMatchObject({ id: "agent-a", modelId: "a" });
		expect([
			a?.task,
			a?.turns,
			a?.checkpointed,
			a?.snapshot,
			a?.tainted,
			a?.requests,
		]).toEqual(["a", 1, 0, "snapshot-a", true, 2]);
		expect(a?.messages).toEqual([
			{ role: "assistant", content: "a" },
			{ role: "user", content: "Continue where your last reply was cut off." },
			{ role: "tool", toolCallId: "call-a", content: "external" },
		]);
		expect(b?.agent).toMatchObject({ id: "agent-b", modelId: "b" });
		expect([
			b?.task,
			b?.turns,
			b?.checkpointed,
			b?.tainted,
			b?.requests,
		]).toEqual(["b", 1, -1, false, 2]);
		expect(b?.messages).toEqual([{ role: "assistant", content: "b" }]);
		expect(live.snapshot.context).toMatchObject({
			messages: coordinator.messages,
			turns: 0,
			checkpointed: -1,
		});
		expect(live.snapshot.context.agent).toBeUndefined();
		expect(save).toHaveBeenCalledTimes(6);
		expect(save.mock.calls.at(-1)?.[1]).toBe(live.snapshot);
	});

	it("keeps completed tool results after pause but refuses late model replies and ended-run progress", () => {
		const { live, state, save } = setup();
		live.snapshot = transition(runMachine, live.snapshot, {
			type: "PAUSE",
			at: 1,
			reason: "user",
		})[0];
		expect(
			applyWorker(state, live, "a", {
				type: "REPLIED",
				message: { role: "assistant", content: "late" },
				finish: "stop",
			}),
		).toBe(false);
		expect(
			applyWorker(state, live, "a", {
				type: "TOOL_DONE",
				message: { role: "tool", toolCallId: "read", content: "kept" },
			}),
		).toBe(true);
		expect(taskContext(live.snapshot.context, "a")?.messages).toEqual([
			{ role: "tool", toolCallId: "read", content: "kept" },
		]);
		expect(live.snapshot.context.requests).toBe(0);
		live.snapshot = transition(runMachine, live.snapshot, {
			type: "CANCEL",
			at: 2,
		})[0];
		expect(
			applyWorker(state, live, "a", { type: "CHECKPOINTED", step: 0 }),
		).toBe(false);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("clears coordinator flags and defaults legacy sessions without mutating them", () => {
		const { live } = setup();
		const team = structuredClone(live.snapshot.context.team);
		if (!team?.tasks.a) throw new Error("missing task");
		delete team.tasks.a.session;
		const context = {
			...live.snapshot.context,
			team,
			review: "lead",
			clarify: "reader",
			judge: true,
			inFlight: "coordinator-call",
		};
		const worker = taskContext(context, "a");
		expect(worker).toMatchObject({
			task: "a",
			turns: 0,
			checkpointed: -1,
			tainted: false,
			agent: undefined,
			review: undefined,
			clarify: undefined,
			judge: undefined,
			inFlight: undefined,
			snapshot: undefined,
		});
		expect(team.tasks.a.session).toBeUndefined();
		expect(taskContext(context, "missing")).toBeUndefined();
	});

	it("persists writing-call recovery markers and counts summaries without adding worker turns", () => {
		const { live, state } = setup();
		applyWorker(state, live, "a", {
			type: "REPLIED",
			message: { role: "assistant", content: "a" },
			finish: "stop",
		});
		applyWorker(state, live, "b", {
			type: "REPLIED",
			message: { role: "assistant", content: "b" },
			finish: "stop",
		});
		applyWorker(state, live, "a", {
			type: "CHECKPOINTED",
			step: 0,
			snapshot: "old",
		});
		applyWorker(state, live, "a", {
			type: "SUMMARIZED",
			messages: [{ role: "user", content: "summary" }],
		});
		applyWorker(state, live, "a", { type: "TOOL_STARTED", callId: "write-a" });
		const saved = loadSnapshot(
			JSON.stringify(runMachine.getPersistedSnapshot(live.snapshot)),
		);
		expect(taskContext(saved.context, "a")).toMatchObject({
			turns: 1,
			checkpointed: -1,
			inFlight: "write-a",
			requests: 3,
		});
		expect(taskContext(saved.context, "a")?.snapshot).toBeUndefined();
		expect(taskContext(saved.context, "b")?.messages).toEqual([
			{ role: "assistant", content: "b" },
		]);
		applyWorker(state, live, "a", {
			type: "TOOL_DONE",
			message: { role: "tool", toolCallId: "write-a", content: "done" },
		});
		expect(taskContext(live.snapshot.context, "a")?.inFlight).toBeUndefined();
	});

	it("does not publish unpersisted progress when saving fails or the task is not active", () => {
		const { live, state, save } = setup();
		const before = live.snapshot;
		save.mockImplementationOnce(() => {
			throw new Error("save failed");
		});
		expect(() =>
			applyWorker(state, live, "a", { type: "CHECKPOINTED", step: 0 }),
		).toThrow("save failed");
		expect(live.snapshot).toBe(before);
		expect(
			applyWorker(state, live, "missing", { type: "CHECKPOINTED", step: 0 }),
		).toBe(false);
	});
});
