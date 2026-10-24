import type { CheckpointRestoreAdapter, MeteEvent } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for checkpoint.restore@1 (ADR-079; SECURITY.md, Checkpoints and rollback).

/** A run and one of its git checkpoints: the id of its `checkpoint.created` event and its ref. */
export type RunCheckpoint = {
	readonly runId: string;
	readonly checkpointId: string;
	readonly ref: string;
};

/**
 * Opens an adapter in a git workspace with a paused run that has one checkpoint and a run that is
 * still running; `events` collects what the adapter's module publishes from then on, in order.
 */
export type CheckpointRestoreHarness = () => Promise<{
	readonly adapter: CheckpointRestoreAdapter;
	readonly events: readonly MeteEvent[];
	readonly paused: RunCheckpoint;
	readonly running: RunCheckpoint;
	readonly close: () => Promise<void>;
}>;

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/** Every checkpoint.restore@1 adapter MUST pass these tests. */
export const checkpointRestoreContract = (
	name: string,
	open: CheckpointRestoreHarness,
) =>
	describe(`checkpoint.restore@1 contract: ${name}`, () => {
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
		const codeOf = async (
			adapter: CheckpointRestoreAdapter,
			input: RunCheckpoint,
		) => {
			const r = await adapter.restore(input);
			return r.ok ? "ok" : r.error.code;
		};

		it("restores a paused run's checkpoint after recording the state before it, and says so", async () => {
			const { adapter, events, paused } = await setup();
			const before = events.length;
			const r = await adapter.restore(paused);
			if (!r.ok) throw new Error(r.error.message);
			expect(r.value.ref).toBe(paused.ref);
			expect(r.value.undo).toMatch(
				new RegExp(`^refs/mete/checkpoints/${paused.runId}/\\d+$`),
			);
			expect(r.value.undo).not.toBe(paused.ref);
			const published = events.slice(before);
			expect(published.map((e) => [e.type, e.runId])).toEqual([
				["checkpoint.created", paused.runId],
				["rollback.performed", paused.runId],
			]);
			expect(published[0]?.payload).toEqual({ kind: "git", ref: r.value.undo });
			expect(published[1]?.payload).toEqual({
				checkpointId: paused.checkpointId,
			});
		});

		it("refuses a ref of another run, an unknown run and a running run, and publishes nothing", async () => {
			const { adapter, events, paused, running } = await setup();
			const before = events.length;
			expect(await codeOf(adapter, { ...paused, ref: running.ref })).toBe(
				"invalid",
			);
			expect(await codeOf(adapter, { ...paused, runId: UNKNOWN })).toBe(
				"invalid",
			);
			const unknown = `refs/mete/checkpoints/${UNKNOWN}/1`;
			expect(
				await codeOf(adapter, { ...paused, runId: UNKNOWN, ref: unknown }),
			).toBe("not_found");
			expect(await codeOf(adapter, running)).toBe("run_active");
			expect(events.slice(before)).toEqual([]);
		});

		it("answers not_found for a checkpoint git does not have", async () => {
			const { adapter, paused } = await setup();
			const ref = `refs/mete/checkpoints/${paused.runId}/999`;
			expect(await codeOf(adapter, { ...paused, ref })).toBe("not_found");
		});
	});
