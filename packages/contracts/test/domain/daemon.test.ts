import { describe, expect, expectTypeOf, it } from "vitest";
import {
	DAEMON_METHODS,
	DaemonErrorDataSchema,
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

describe("daemon protocol version 1", () => {
	it("names the two messages of ARCHITECTURE.md", () => {
		expect(DAEMON_METHODS).toEqual({
			status: "mete/status",
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
			"choose_template",
		])
			expect(DaemonErrorDataSchema.parse({ code })).toEqual({ code });
		expect(DaemonErrorDataSchema.safeParse({ code: "oops" }).success).toBe(
			false,
		);
		expectTypeOf<
			ReturnType<typeof DaemonErrorDataSchema.parse>["code"]
		>().toEqualTypeOf<EngineError["code"]>();
	});
});
