import type {
	EngineError,
	MeteEvent,
	Result,
	RunView,
	TeamEngineAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

// Contract kit for team.engine@2 (docs/06 engine types, docs/07 Run state machine, docs/08 Single agent and teams).

/**
 * What the model behind the engine does: answer at once with text, take its time until
 * the call is aborted, or find every provider's quota used up for a long while.
 */
export type EngineScenario = "answers" | "slow" | "quota-exhausted";

/** Opens an engine for one scenario; `events` collects what it publishes, in order. */
export type TeamEngineHarness = (scenario: EngineScenario) => Promise<{
	readonly engine: TeamEngineAdapter;
	readonly events: readonly MeteEvent[];
	readonly close: () => Promise<void>;
}>;

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/** Every team.engine@2 adapter MUST pass these tests. */
export const teamEngineContract = (name: string, open: TeamEngineHarness) =>
	describe(`team.engine@2 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const setup = async (scenario: EngineScenario) => {
			const h = await open(scenario);
			close = h.close;
			return h;
		};
		const started = async (engine: TeamEngineAdapter) => {
			const r = await engine.start({ goal: "say hello" });
			if (!r.ok) throw new Error(r.error.message);
			return r.value.runId;
		};
		const view = (engine: TeamEngineAdapter, runId: string): RunView => {
			const r = engine.status(runId);
			const [one, ...more] = r.ok ? r.value : [];
			if (!one || more.length > 0) throw new Error("expected one run");
			return one;
		};
		const until = (engine: TeamEngineAdapter, runId: string, s: string) =>
			vi.waitFor(() => expect(view(engine, runId).status).toBe(s));

		it("completes a single-agent run and publishes its life in order", async () => {
			const { engine, events } = await setup("answers");
			const runId = await started(engine);
			await until(engine, runId, "completed");
			const run = events.filter((e) => e.type.startsWith("run."));
			expect(run.map((e) => e.type)).toEqual([
				"run.created",
				"run.started",
				"run.completed",
			]);
			expect(run.every((e) => e.runId === runId)).toBe(true);
			expect(view(engine, runId)).toMatchObject({
				templateId: null,
				goal: "say hello",
			});
			expect(view(engine, runId).endedAt).toBeDefined();
		});

		it("refuses unknown templates, empty goals and unknown runs", async () => {
			const { engine } = await setup("answers");
			const code = async (p: Promise<Result<unknown, EngineError>>) => {
				const r = await p;
				return r.ok ? "ok" : r.error.code;
			};
			// An engine without templates refuses them; one with templates does not know x.
			expect(["not_supported", "not_found"]).toContain(
				await code(engine.start({ goal: "g", templateId: "x" })),
			);
			expect(await code(engine.start({ continue: true }))).toBe("not_found");
			const decision = { decision: "approve" } as const;
			expect(await code(engine.approve(UNKNOWN, decision))).toBe("not_found");
			expect(await code(engine.start({ goal: " " }))).toBe("bad_input");
			for (const call of [engine.pause, engine.resume, engine.cancel])
				expect(await code(call.call(engine, UNKNOWN))).toBe("not_found");
			const s = engine.status(UNKNOWN);
			expect(s.ok ? "ok" : s.error.code).toBe("not_found");
		});

		it("pauses for the user, resumes and cancels", async () => {
			const { engine, events } = await setup("slow");
			const runId = await started(engine);
			expect((await engine.pause(runId)).ok).toBe(true);
			expect(view(engine, runId)).toMatchObject({
				status: "paused",
				pauseReason: "user",
			});
			const again = await engine.pause(runId);
			expect(again.ok ? undefined : again.error).toMatchObject({
				code: "invalid_state",
				status: "paused",
			});
			expect((await engine.resume(runId)).ok).toBe(true);
			expect(view(engine, runId).status).toBe("running");
			expect((await engine.cancel(runId)).ok).toBe(true);
			expect(view(engine, runId).status).toBe("cancelled");
			const late = await engine.resume(runId);
			expect(late.ok ? undefined : late.error).toMatchObject({
				code: "invalid_state",
				status: "cancelled",
			});
			expect(events.map((e) => e.type)).toEqual(
				expect.arrayContaining(["run.paused", "run.resumed", "run.cancelled"]),
			);
		});

		it("refuses an approval for a run that does not wait for one", async () => {
			const { engine } = await setup("answers");
			const runId = await started(engine);
			await until(engine, runId, "completed");
			const r = await engine.approve(runId, { decision: "approve" });
			expect(r.ok ? "ok" : r.error.code).toBe("invalid_state");
		});

		it("pauses with reason quota and a resume time when quota is used up", async () => {
			const { engine, events } = await setup("quota-exhausted");
			const runId = await started(engine);
			await until(engine, runId, "paused");
			expect(view(engine, runId).pauseReason).toBe("quota");
			const paused = events.find((e) => e.type === "run.paused");
			expect(paused?.payload).toMatchObject({ reason: "quota" });
			expect(paused?.payload).toHaveProperty("resumesAt");
		});

		it("lists every run, newest first", async () => {
			const { engine } = await setup("slow");
			const first = await started(engine);
			const second = await started(engine);
			const all = engine.status();
			expect(all.ok && all.value.map((r) => r.id)).toEqual([second, first]);
		});
	});
