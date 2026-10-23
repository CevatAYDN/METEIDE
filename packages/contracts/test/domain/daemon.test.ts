import { describe, expect, expectTypeOf, it } from "vitest";
import {
	DAEMON_METHODS,
	DaemonDoneResultSchema,
	type DaemonErrorData,
	DaemonErrorDataSchema,
	DaemonEventsResultSchema,
	DaemonQuotaResultSchema,
	DaemonRunApproveParamsSchema,
	DaemonRunIdParamsSchema,
	DaemonRunStartResultSchema,
	DaemonStatusParamsSchema,
	DaemonStatusResultSchema,
	RunViewSchema,
} from "../../src/domain/daemon.js";
import type { EngineError, RunView } from "../../src/domain/engine.js";

// Typed as RunView, so a field added to the type stops this file from compiling until the schema follows.
const run: RunView = {
	id: crypto.randomUUID(),
	workspaceId: crypto.randomUUID(),
	templateId: "research",
	goal: "write the report",
	status: "paused",
	pauseReason: "quota",
	autonomyLevel: 2,
	budget: { cloudRequests: 40, maxHours: 2 },
	createdAt: "2026-10-23T10:00:00.000Z",
	startedAt: "2026-10-23T10:00:01.000Z",
	endedAt: "2026-10-23T11:00:00.000Z",
};

describe("daemon protocol version 6", () => {
	it("answers mete/events with the run's events in order and the count of unreadable rows", () => {
		const event = {
			id: crypto.randomUUID(),
			ts: "2026-10-23T10:00:00.000Z",
			schema: 1,
			workspaceId: run.workspaceId,
			runId: run.id,
			source: "core-engine",
			type: "run.started",
			payload: {},
		};
		const answer = {
			events: [event, { ...event, id: crypto.randomUUID() }],
			unreadable: 2,
		};
		expect(DaemonEventsResultSchema.parse(answer)).toEqual(answer);
		expect(
			DaemonEventsResultSchema.parse({ events: [], unreadable: 0 }),
		).toEqual({
			events: [],
			unreadable: 0,
		});
		for (const bad of [
			{ events: [{ ...event, type: "run.dreamed" }], unreadable: 0 },
			{ events: [], unreadable: -1 },
			{ events: [], unreadable: 0.5 },
			{ events: [] },
			{ events: [], unreadable: 0, extra: true },
		])
			expect(DaemonEventsResultSchema.safeParse(bad).success).toBe(false);
	});

	it("names the messages of ARCHITECTURE.md", () => {
		expect(DAEMON_METHODS).toEqual({
			status: "mete/status",
			runStart: "mete/run.start",
			runApprove: "mete/run.approve",
			runResume: "mete/run.resume",
			quota: "mete/quota",
			events: "mete/events",
			event: "mete/event",
		});
	});

	it("takes an optional run id for mete/status", () => {
		expect(DaemonStatusParamsSchema.parse({})).toEqual({});
		expect(DaemonStatusParamsSchema.parse({ runId: "r1" })).toEqual({
			runId: "r1",
		});
		for (const bad of [{ runId: "" }, { runId: 1 }, { extra: true }])
			expect(DaemonStatusParamsSchema.safeParse(bad).success).toBe(false);
	});

	it("round-trips a full run and one without the optional fields", () => {
		const bare: RunView = {
			id: run.id,
			workspaceId: run.workspaceId,
			templateId: null,
			goal: "fix it",
			status: "queued",
			autonomyLevel: 0,
			budget: { cloudRequests: 1, maxHours: 0.5 },
			createdAt: run.createdAt,
		};
		expect(DaemonStatusResultSchema.parse([run, bare])).toEqual([run, bare]);
		expect(DaemonStatusResultSchema.parse([])).toEqual([]);
	});

	it("refuses a run that drifted from the RunView shape", () => {
		for (const bad of [
			{ ...run, status: "sleeping" },
			{ ...run, pauseReason: "tired" },
			{ ...run, autonomyLevel: 4 },
			{ ...run, id: "not-a-uuid" },
			{ ...run, createdAt: "yesterday" },
			{ ...run, budget: { cloudRequests: -1, maxHours: 2 } },
			{ ...run, extra: true },
		])
			expect(RunViewSchema.safeParse(bad).success).toBe(false);
		expect(DaemonStatusResultSchema.safeParse(run).success).toBe(false);
	});

	it("carries an EngineError code in the error data", () => {
		for (const code of [
			"bad_input",
			"not_found",
			"not_supported",
			"invalid_state",
		])
			expect(DaemonErrorDataSchema.parse({ code })).toEqual({ code });
		expect(DaemonErrorDataSchema.safeParse({ code: "oops" }).success).toBe(
			false,
		);
		expectTypeOf<Exclude<DaemonErrorData["code"], "not_ready">>().toEqualTypeOf<
			EngineError["code"]
		>();
	});

	it("carries not_ready with the reasons mete status would print", () => {
		const data = {
			code: "not_ready",
			reasons: [
				"core-engine is not active.",
				"Add a provider key with: mete key set openrouter",
			],
		};
		expect(DaemonErrorDataSchema.parse(data)).toEqual(data);
		for (const bad of [
			{ code: "not_ready" },
			{ code: "not_ready", reasons: [] },
			{ code: "not_ready", reasons: [1] },
			{ code: "not_found", reasons: ["x"] },
			{ code: "not_ready", reasons: ["x"], extra: true },
		])
			expect(DaemonErrorDataSchema.safeParse(bad).success).toBe(false);
	});

	it("carries the router's suggestions with choose_template", () => {
		const data = {
			code: "choose_template",
			suggestions: ["research", "web-dev"],
		};
		expect(DaemonErrorDataSchema.parse(data)).toEqual(data);
		for (const bad of [
			{ code: "choose_template" },
			{ code: "choose_template", suggestions: [] },
			{ code: "not_found", suggestions: ["x"] },
		])
			expect(DaemonErrorDataSchema.safeParse(bad).success).toBe(false);
	});

	it("answers mete/run.start with the id of the run it started", () => {
		const runId = crypto.randomUUID();
		expect(DaemonRunStartResultSchema.parse({ runId })).toEqual({ runId });
		for (const bad of [{}, { runId: "r1" }, { runId, extra: true }])
			expect(DaemonRunStartResultSchema.safeParse(bad).success).toBe(false);
	});

	it("takes a run and the human's decision for mete/run.approve, a run for mete/run.resume", () => {
		const approve = {
			runId: "r1",
			input: { decision: "revise", feedback: "shorter" },
		};
		expect(DaemonRunApproveParamsSchema.parse(approve)).toEqual(approve);
		for (const bad of [
			{ runId: "r1" },
			{ runId: "", input: { decision: "approve" } },
			{ runId: "r1", input: { decision: "revise" } },
			{ runId: "r1", input: { decision: "maybe" } },
			{ runId: "r1", input: { decision: "approve" }, extra: 1 },
		])
			expect(DaemonRunApproveParamsSchema.safeParse(bad).success).toBe(false);
		expect(DaemonRunIdParamsSchema.parse({ runId: "r1" })).toEqual({
			runId: "r1",
		});
		expect(DaemonRunIdParamsSchema.safeParse({}).success).toBe(false);
		expect(DaemonDoneResultSchema.parse(null)).toBeNull();
		expect(DaemonDoneResultSchema.safeParse({}).success).toBe(false);
	});

	it("answers mete/quota with a state per provider, and a reset time only when exhausted", () => {
		const quota = {
			providers: [
				{ id: "groq", state: "ready" },
				{ id: "nvidia", state: "no_key" },
				{ id: "google", state: "inactive" },
				{
					id: "openrouter",
					state: "exhausted",
					resetsAt: "2026-10-24T00:00:00.000Z",
				},
				{ id: "shy", state: "unusable" },
			],
		};
		expect(DaemonQuotaResultSchema.parse(quota)).toEqual(quota);
		for (const bad of [
			{ providers: [{ id: "x", state: "exhausted" }] },
			{
				providers: [
					{ id: "x", state: "ready", resetsAt: "2026-10-24T00:00:00.000Z" },
				],
			},
			{ providers: [{ id: "", state: "ready" }] },
			{ providers: [{ id: "x", state: "tired" }] },
		])
			expect(DaemonQuotaResultSchema.safeParse(bad).success).toBe(false);
	});
});
