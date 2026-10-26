import { parseTemplate } from "@mete/contracts";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import {
	type RunEvent,
	type RunSnapshot,
	runMachine,
} from "../../src/domain/run-machine.js";
import { teamOf } from "../../src/domain/team.js";
import {
	createRunStore,
	loadSnapshot,
	RUN_MIGRATIONS,
	type RunMeta,
} from "../../src/infrastructure/run-store.js";

const open = () => {
	const db = new Database(":memory:");
	for (const m of RUN_MIGRATIONS) db.exec(m.sql);
	return { db, store: createRunStore(db) };
};

const meta = (id: string, createdAt = "2026-10-21T10:00:00.000Z"): RunMeta => ({
	id,
	workspaceId: "ws",
	autonomyLevel: 2,
	budget: { cloudRequests: 150, maxHours: 6 },
	createdAt,
});

const snapshot = (...events: RunEvent[]): RunSnapshot =>
	events.reduce(
		(s, e) => transition(runMachine, s, e)[0],
		initialTransition(runMachine, {
			goal: "fix it",
			priority: 1,
			messages: [],
		})[0],
	);

const T0 = Date.parse("2026-10-21T10:00:01.000Z");

describe("run store", () => {
	it("writes the row after each transition and reads the run back", () => {
		const { store } = open();
		const running = snapshot({ type: "START", at: T0 });
		store.save(meta("r1"), running);
		const paused = transition(runMachine, running, {
			type: "PAUSE",
			at: T0 + 5,
			reason: "quota",
			resumesAt: "2026-10-21T11:00:00.000Z",
		})[0];
		store.save(meta("r1"), paused);
		expect(store.list("r1")).toEqual([
			{
				id: "r1",
				workspaceId: "ws",
				templateId: null,
				goal: "fix it",
				status: "paused",
				pauseReason: "quota",
				autonomyLevel: 2,
				budget: { cloudRequests: 150, maxHours: 6 },
				createdAt: "2026-10-21T10:00:00.000Z",
				startedAt: "2026-10-21T10:00:01.000Z",
			},
		]);
		const back = store.load("r1");
		expect(back?.meta).toEqual(meta("r1"));
		expect(back?.snapshot.value).toBe("paused");
		expect(back?.snapshot.context).toEqual(paused.context);
		expect(store.load("nope")).toBeUndefined();
	});

	it("drops the pause reason once the run is no longer paused", () => {
		const { store } = open();
		const s = snapshot(
			{ type: "START", at: T0 },
			{ type: "PAUSE", at: T0 + 1, reason: "user" },
			{ type: "CANCEL", at: T0 + 2 },
		);
		store.save(meta("r1"), s);
		const [run] = store.list("r1");
		expect(run?.status).toBe("cancelled");
		expect(run).not.toHaveProperty("pauseReason");
		expect(run?.endedAt).toBe("2026-10-21T10:00:01.002Z");
	});

	it("lists newest first and finds runs left queued or running", () => {
		const { store } = open();
		const at = "2026-10-21T10:00:00.000Z";
		store.save(meta("old", "2026-10-20T10:00:00.000Z"), snapshot());
		store.save(meta("a", at), snapshot({ type: "START", at: T0 }));
		store.save(
			meta("b", at),
			snapshot(
				{ type: "START", at: T0 },
				{ type: "COMPLETE", at: T0, summary: "s" },
			),
		);
		expect(store.list().map((r) => r.id)).toEqual(["b", "a", "old"]);
		expect(store.unfinished().sort()).toEqual(["a", "old"]);
	});

	it("writes the agent row with its model and requests together with the run", () => {
		const { db, store } = open();
		const agent = { id: "ag", providerId: "p", modelId: "m1" };
		const replied = snapshot(
			{ type: "START", at: T0 },
			{ type: "MODEL", agent },
			{
				type: "REPLIED",
				message: { role: "assistant", content: "hi" },
				finish: "stop",
			},
			{ type: "MODEL", agent: { ...agent, modelId: "m2" } },
		);
		store.save(meta("r1"), replied);
		expect(db.prepare("SELECT * FROM agents").all()).toEqual([
			{
				id: "ag",
				run_id: "r1",
				role_id: "assistant",
				provider_id: "p",
				model_id: "m2",
				requests: 1,
			},
		]);
		db.exec("DROP TABLE agents");
		const done = snapshot({ type: "START", at: T0 }, { type: "MODEL", agent });
		expect(() => store.save(meta("r2"), done)).toThrow();
		expect(store.list("r2")).toEqual([]);
	});

	it("keeps a team run's template id and state, and reads a row from before the request counter", () => {
		const { store } = open();
		const template = parseTemplate({
			apiVersion: "mete/v1",
			kind: "TeamTemplate",
			metadata: { id: "solo", name: "Solo", version: "1.0.0" },
			pattern: "pipeline",
			roles: [
				{ id: "w", name: "W", goal: "g", tier: "fast", capabilities: [] },
			],
			tasks: [{ id: "t", role: "w", title: "T" }],
		});
		if (!template.ok) throw new Error("template");
		const team = teamOf(template.value);
		const s = snapshot({ type: "START", at: T0 }, { type: "TEAM", team });
		store.save(meta("r1"), s);
		expect(store.list("r1")[0]?.templateId).toBe("solo");
		expect(store.load("r1")?.snapshot.context.team).toEqual(team);
		const old = runMachine.getPersistedSnapshot(snapshot());
		const json = JSON.stringify(old).replace('"requests":0,', "");
		expect(
			loadSnapshot(json.replace('"turns":0', '"turns":3')).context.requests,
		).toBe(3);
	});

	it("refuses a damaged snapshot", () => {
		expect(() => loadSnapshot('{"value":"running","context":{}}')).toThrow();
		expect(() => loadSnapshot('{"value":"lost","context":{}}')).toThrow();
	});

	it("persists and restores prefer and preferRevision across snapshots", () => {
		const { store } = open();
		const prefer = { providerId: "prov-a", modelId: "mod-a" };
		const s = initialTransition(runMachine, {
			goal: "fix it",
			priority: 1,
			messages: [],
			prefer,
		})[0];
		const updated = transition(runMachine, s, {
			type: "PREFER",
			prefer: { providerId: "prov-b", modelId: "mod-b" },
		})[0];
		store.save(meta("r1"), updated);

		const loaded = store.load("r1");
		expect(loaded?.snapshot.context.prefer).toEqual({
			providerId: "prov-b",
			modelId: "mod-b",
		});
		expect(loaded?.snapshot.context.preferRevision).toBe(1);
	});
});
