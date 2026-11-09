import {
	type TaskVerificationAdapter,
	TaskVerificationResultSchema,
	type TeamEngineV3Adapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Required v1 and explicit-optional v2 fixtures both name a capability absent from their registry. */
export type VerificationHarness = () => Promise<{
	readonly engine: TeamEngineV3Adapter;
	readonly verification: TaskVerificationAdapter;
	readonly templates: { readonly required: string; readonly optional: string };
	readonly close: () => Promise<void>;
}>;

const currentGates = (input: unknown) => {
	const result = TaskVerificationResultSchema.parse(input);
	expect(result.mode).toBe("strict");
	expect(result.tasks).toHaveLength(1);
	const task = result.tasks[0];
	if (!task) throw new Error("expected the fixture task");
	const current = task.evaluations.find(
		(e) => e.attemptId === task.currentAttemptId,
	);
	if (!current) throw new Error("current attempt has no verification evidence");
	return current.gates;
};

/** task.verification@1 and team.engine@3 must agree on real new-run gate outcomes. */
export const taskVerificationContract = (
	name: string,
	open: VerificationHarness,
) =>
	describe(`task.verification@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const setup = async () => {
			const h = await open();
			close = h.close;
			return h;
		};
		const start = async (
			h: Awaited<ReturnType<VerificationHarness>>,
			templateId: string,
		) => {
			const r = await h.engine.start({ goal: "Check the fixture", templateId });
			if (!r.ok) throw new Error(r.error.message);
			return r.value.runId;
		};
		const until = (
			h: Awaited<ReturnType<VerificationHarness>>,
			id: string,
			status: string,
		) =>
			vi.waitFor(() => {
				const r = h.engine.status(id);
				expect(r.ok && r.value[0]?.status).toBe(status);
			});

		it("blocks a new legacy-template run on its missing required gate", async () => {
			const h = await setup();
			const id = await start(h, h.templates.required);
			await until(h, id, "paused");
			const r = await h.verification.read({ runId: id });
			if (!r.ok) throw new Error(r.error.message);
			const view = h.engine.status(id);
			expect(view.ok && view.value[0]).toMatchObject({
				status: "paused",
				pauseReason: "approval",
			});
			expect(currentGates(r.value)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						status: "not_run",
						reason: "capability_missing",
						optional: false,
					}),
				]),
			);
		});

		it("allows an explicit optional gap without reporting a pass", async () => {
			const h = await setup();
			const id = await start(h, h.templates.optional);
			await until(h, id, "completed");
			const r = await h.verification.read({ runId: id });
			if (!r.ok) throw new Error(r.error.message);
			const rows = currentGates(r.value);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				index: 0,
				status: "not_run",
				reason: "capability_missing",
				optional: true,
			});
			expect(await h.verification.read({ runId: id })).toEqual(r);
		});

		it("does not turn a missing run or invalid input into empty evidence", async () => {
			const h = await setup();
			const absent = await h.verification.read({
				runId: "00000000-0000-4000-8000-000000000000",
			});
			expect(absent.ok ? "ok" : absent.error.code).toBe("not_found");
			const invalid = await h.verification.read({ runId: "not-an-id" });
			expect(invalid.ok ? "ok" : invalid.error.code).toBe("bad_input");
		});
	});
