import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelRef, parseTemplate, type RunPrefer } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isModelRef,
	nextPrefer,
	pinnedSeat,
	runPreferOf,
} from "../../src/application/pinned.js";
import type { EngineState, Live } from "../../src/application/run-state.js";
import type { RunContext, RunSnapshot } from "../../src/domain/run-machine.js";
import { type TeamState, teamOf } from "../../src/domain/team.js";

const MODEL_A: ModelRef = { providerId: "prov-a", modelId: "mod-a" };
const MODEL_B: ModelRef = { providerId: "prov-b", modelId: "mod-b" };
const MODEL_PIN: ModelRef = { providerId: "prov-pin", modelId: "mod-pin" };

const parsed = parseTemplate({
	apiVersion: "mete/v1",
	kind: "TeamTemplate",
	metadata: { id: "test-team", name: "Test Team", version: "1.0.0" },
	pattern: "single",
	roles: [
		{
			id: "lead",
			name: "Lead",
			goal: "Lead",
			tier: "reasoning",
			capabilities: [],
		},
		{
			id: "coder",
			name: "Coder",
			goal: "Code",
			tier: "coder",
			capabilities: [],
		},
	],
	tasks: [
		{ id: "t1", role: "lead", title: "Task 1" },
		{ id: "t2", role: "coder", title: "Task 2" },
	],
});
if (!parsed.ok) throw new Error(parsed.error.issues.join("; "));
const dummyTeam: TeamState = teamOf(parsed.value);

const fakeLive = (context: Partial<RunContext>, value = "running"): Live => ({
	meta: {
		id: "run-1",
		workspaceId: "ws-1",
		autonomyLevel: 1,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: new Date().toISOString(),
	},
	snapshot: {
		value,
		context: {
			goal: "test",
			priority: 1,
			messages: [],
			turns: 0,
			requests: 0,
			activeMs: 0,
			checkpointed: -1,
			...context,
		},
	} as unknown as RunSnapshot,
	token: {},
	loop: Promise.resolve(),
	all: new AbortController(),
});

describe("pinned helper functions", () => {
	it("distinguishes ModelRef from role-preference records", () => {
		expect(isModelRef(MODEL_A)).toBe(true);
		expect(isModelRef({ lead: MODEL_A })).toBe(false);
		expect(isModelRef(null as unknown as RunPrefer)).toBe(false);
		expect(isModelRef(undefined as unknown as RunPrefer)).toBe(false);
	});

	it("extracts runPreferOf correctly for single agent and team runs", () => {
		const singleContext: RunContext = {
			goal: "test",
			priority: 1,
			messages: [],
			turns: 0,
			requests: 0,
			activeMs: 0,
			checkpointed: -1,
			prefer: MODEL_A,
		};
		expect(runPreferOf(singleContext)).toEqual(MODEL_A);
		expect(
			runPreferOf({ ...singleContext, prefer: undefined }),
		).toBeUndefined();

		const teamContext: RunContext = {
			...singleContext,
			team: dummyTeam,
			prefer: { lead: MODEL_A, coder: MODEL_B },
		};
		expect(runPreferOf(teamContext, "lead")).toEqual(MODEL_A);
		expect(runPreferOf(teamContext, "coder")).toEqual(MODEL_B);
		expect(runPreferOf(teamContext, "unknown")).toBeUndefined();
		expect(runPreferOf(teamContext)).toBeUndefined();
	});

	it("computes nextPrefer for single agent and team runs", () => {
		const singleContext = fakeLive({ prefer: MODEL_A }).snapshot.context;
		expect(nextPrefer(singleContext, MODEL_B)).toEqual({
			ok: true,
			value: MODEL_B,
		});
		expect(nextPrefer(singleContext, null)).toEqual({
			ok: true,
			value: undefined,
		});

		const teamContext = fakeLive({
			team: dummyTeam,
			task: "t1",
			prefer: { lead: MODEL_A },
		}).snapshot.context;
		// Updates active role when roleId is omitted
		expect(nextPrefer(teamContext, MODEL_B)).toEqual({
			ok: true,
			value: { lead: MODEL_B },
		});
		// Updates specified role
		expect(nextPrefer(teamContext, MODEL_B, "coder")).toEqual({
			ok: true,
			value: { lead: MODEL_A, coder: MODEL_B },
		});
		// Removes role on null
		expect(nextPrefer(teamContext, null, "lead")).toEqual({
			ok: true,
			value: undefined,
		});
	});

	it("fails nextPrefer when roleId is missing on queued team run", () => {
		const teamQueued = fakeLive({ team: dummyTeam }).snapshot.context;
		const r = nextPrefer(teamQueued, MODEL_A);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("bad_input");
	});
});

describe("pinnedSeat priority and invalidation", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mete-pinned-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	const fakeState = (workspace: string): EngineState =>
		({
			deps: {
				templates: { builtIn: workspace, workspace },
				logger: { warn: vi.fn() },
			},
			live: new Map(),
			onPauseEnded: vi.fn(),
		}) as unknown as EngineState;

	it("honors single-agent run preference", async () => {
		const s = fakeState(tmpDir);
		const l = fakeLive({ prefer: MODEL_A, preferRevision: 0 });
		const seat = await pinnedSeat(s, l);
		expect(seat.prefer).toEqual(MODEL_A);
		expect(l.pin).toEqual({ key: "single", revision: 0, prefer: MODEL_A });
	});

	it("honors team run-specific preference over workspace pin", async () => {
		// Write workspace pin in .mete/pins.yaml
		await mkdir(join(tmpDir, ".mete"), { recursive: true });
		const pinsYaml = "test-team:\n  lead: prov-pin/mod-pin\n";
		await writeFile(join(tmpDir, ".mete", "pins.yaml"), pinsYaml);

		const s = fakeState(tmpDir);
		const l = fakeLive({
			team: dummyTeam,
			task: "t1",
			prefer: { lead: MODEL_A },
			preferRevision: 0,
		});

		const seat = await pinnedSeat(s, l);
		// Run-specific prefer takes precedence over workspace pin
		expect(seat.prefer).toEqual(MODEL_A);
	});

	it("falls back to workspace pin when run preference is absent", async () => {
		await mkdir(join(tmpDir, ".mete"), { recursive: true });
		const pinsYaml = "test-team:\n  lead: prov-pin/mod-pin\n";
		await writeFile(join(tmpDir, ".mete", "pins.yaml"), pinsYaml);

		const s = fakeState(tmpDir);
		const l = fakeLive({
			team: dummyTeam,
			task: "t1",
			preferRevision: 0,
		});

		const seat = await pinnedSeat(s, l);
		expect(seat.prefer).toEqual(MODEL_PIN);
	});

	it("falls back to tier chain default when neither run preference nor pin exists", async () => {
		const s = fakeState(tmpDir);
		const l = fakeLive({
			team: dummyTeam,
			task: "t1",
			preferRevision: 0,
		});

		const seat = await pinnedSeat(s, l);
		expect(seat.prefer).toBeUndefined();
	});

	it("invalidates cache when preferRevision changes mid-run", async () => {
		const s = fakeState(tmpDir);
		const l = fakeLive({ prefer: MODEL_A, preferRevision: 0 });

		const seat1 = await pinnedSeat(s, l);
		expect(seat1.prefer).toEqual(MODEL_A);
		expect(l.pin?.revision).toBe(0);

		// Cache hit when key and revision match
		const seatCached = await pinnedSeat(s, l);
		expect(seatCached.prefer).toEqual(MODEL_A);

		// Mid-run change updates prefer and bumps preferRevision
		l.snapshot = {
			...l.snapshot,
			context: {
				...l.snapshot.context,
				prefer: MODEL_B,
				preferRevision: 1,
			},
		};

		// Cache is invalidated because revision changed (1 !== 0)
		const seat2 = await pinnedSeat(s, l);
		expect(seat2.prefer).toEqual(MODEL_B);
		expect(l.pin?.revision).toBe(1);
	});
});
