import { parseTemplate } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { initialTransition, transition } from "xstate";
import {
	apply,
	type EngineState,
	type Live,
} from "../../src/application/run-state.js";
import { applyWorker, keepWorker } from "../../src/application/task-worker.js";
import { finishAttempt } from "../../src/domain/attempts.js";
import { nextStep } from "../../src/domain/next-step.js";
import { runMachine } from "../../src/domain/run-machine.js";
import { applyTask, teamOf } from "../../src/domain/team.js";
import { loadSnapshot } from "../../src/infrastructure/run-store.js";

const setup = () => {
	const parsed = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "slots", name: "Slots", version: "1.0.0" },
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
	if (!parsed.ok) throw new Error("invalid fixture");
	let team = teamOf(parsed.value);
	for (const task of ["a", "b"])
		team = applyTask(team, task, { type: "START", agentId: task }).team;
	let snapshot = initialTransition(runMachine, {
		goal: "read",
		priority: 1,
		messages: [],
	})[0];
	snapshot = transition(runMachine, snapshot, { type: "TEAM", team })[0];
	snapshot = transition(runMachine, snapshot, { type: "START", at: 0 })[0];
	const live: Live = {
		meta: {
			id: "run",
			workspaceId: "ws",
			autonomyLevel: 2,
			budget: { cloudRequests: 1, maxHours: 1 },
			createdAt: "2026-11-07T00:00:00.000Z",
		},
		snapshot,
		token: {},
		all: new AbortController(),
		loop: Promise.resolve(),
	};
	const state = {
		deps: { store: { save: vi.fn() } },
	} as unknown as EngineState;
	return { live, state };
};

const reservation = (id: string, task = "a") => ({ id, task, agentId: task });
const reply = (id: string) => ({
	type: "REPLIED" as const,
	reservation: id,
	message: { role: "assistant" as const, content: "report" },
	finish: "stop" as const,
});

describe("shared request reservations", () => {
	it("does not copy a finished sequential attempt over the next attempt's fresh session", () => {
		const { live, state } = setup();
		const context = live.snapshot.context;
		if (!context.team) throw new Error("missing fixture team");
		const messages = [{ role: "assistant" as const, content: "old attempt" }];
		live.snapshot = runMachine.resolveState({
			value: "running",
			context: {
				...context,
				task: "a",
				messages,
				turns: 2,
				team: finishAttempt(
					context.team,
					"a",
					{ messages, report: "old" },
					"next",
				),
			},
		});
		const before = live.snapshot;
		keepWorker(state, live);
		expect(live.snapshot).toBe(before);
		expect(live.snapshot.context.team?.tasks.a?.session?.turns).toBe(0);
		expect(live.snapshot.context.team?.tasks.a?.messages).toEqual([]);
	});
	it("reserves the final slot atomically, persists it, and settles a reply exactly once", () => {
		const { live, state } = setup();
		expect(
			apply(state, live, {
				type: "RESERVE",
				reservation: reservation("one"),
				limit: 1,
			}),
		).toBe(true);
		expect(
			apply(state, live, {
				type: "RESERVE",
				reservation: reservation("two", "b"),
				limit: 1,
			}),
		).toBe(false);
		expect(nextStep(live.snapshot.context, live.meta.budget, 0).kind).toBe(
			"pause",
		);
		const saved = loadSnapshot(
			JSON.stringify(runMachine.getPersistedSnapshot(live.snapshot)),
		);
		expect(saved.context.reservations).toEqual([reservation("one")]);
		expect(applyWorker(state, live, "a", reply("one"))).toBe(true);
		expect(applyWorker(state, live, "a", reply("one"))).toBe(false);
		expect(live.snapshot.context).toMatchObject({
			requests: 1,
			reservations: [],
		});
		expect(live.snapshot.context.team?.tasks.a?.messages).toHaveLength(1);
	});

	it("releases errors or missing calls without counting a request and rejects another task's identity", () => {
		const { live, state } = setup();
		apply(state, live, {
			type: "RESERVE",
			reservation: reservation("one"),
			limit: 1,
		});
		expect(applyWorker(state, live, "b", reply("one"))).toBe(false);
		expect(apply(state, live, { type: "RELEASE", id: "one" })).toBe(true);
		expect(apply(state, live, { type: "RELEASE", id: "one" })).toBe(false);
		expect(live.snapshot.context.requests).toBe(0);
		expect(
			apply(state, live, {
				type: "RESERVE",
				reservation: reservation("two", "b"),
				limit: 1,
			}),
		).toBe(true);
	});

	it("invalidates old reservations on pause, then refuses their replies after resume", () => {
		const { live, state } = setup();
		apply(state, live, {
			type: "RESERVE",
			reservation: reservation("old"),
			limit: 1,
		});
		// Avoid handoff/event dependencies in this machine-only stop fixture.
		live.snapshot = transition(runMachine, live.snapshot, {
			type: "PAUSE",
			at: 1,
			reason: "user",
		})[0];
		live.snapshot = transition(runMachine, live.snapshot, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(applyWorker(state, live, "a", reply("old"))).toBe(false);
		expect(live.snapshot.context.reservations).toEqual([]);
	});

	it("loads legacy snapshots with no reservations and releases a recovered paused row on resume", () => {
		const { live } = setup();
		const persisted = JSON.parse(
			JSON.stringify(runMachine.getPersistedSnapshot(live.snapshot)),
		);
		delete persisted.context.reservations;
		expect(
			loadSnapshot(JSON.stringify(persisted)).context.reservations,
		).toEqual([]);
		persisted.value = "paused";
		persisted.context.reservations = [reservation("stale")];
		const recovered = loadSnapshot(JSON.stringify(persisted));
		const resumed = transition(runMachine, recovered, {
			type: "RESUME",
			at: 2,
		})[0];
		expect(resumed.context.reservations).toEqual([]);
		expect(resumed.context.requests).toBe(0);
	});
});
