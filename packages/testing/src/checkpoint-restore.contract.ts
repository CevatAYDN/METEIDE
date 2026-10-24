import type { CheckpointRestoreAdapter, MeteEvent } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for checkpoint.restore@1 (ADR-079, ADR-080; SECURITY.md, Checkpoints and rollback):
// every test runs for a git checkpoint and for a file snapshot.

/** A run and one of its checkpoints: the id of its `checkpoint.created` event and its ref. */
export type RunCheckpoint = {
	readonly runId: string;
	readonly checkpointId: string;
	readonly ref: string;
};

/** The two kinds of checkpoint. */
export type CheckpointKind = "git" | "snapshot";

/**
 * Opens an adapter in a workspace, a git repository for `git` and a plain folder for `snapshot`,
 * with a paused run that has one checkpoint of that kind and a run that is still running; `events`
 * collects what the adapter's module publishes from then on, in order.
 */
export type CheckpointRestoreHarness = (kind: CheckpointKind) => Promise<{
	readonly adapter: CheckpointRestoreAdapter;
	readonly events: readonly MeteEvent[];
	readonly paused: RunCheckpoint;
	readonly running: RunCheckpoint;
	readonly close: () => Promise<void>;
}>;

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/** The refs of a run's checkpoints of a kind, up to the number. */
const prefixOf = (kind: CheckpointKind, runId: string) =>
	kind === "git" ? `refs/mete/checkpoints/${runId}/` : `snapshots/${runId}/`;

/** Checkpoint n of a run, as checkpoint.created names it for the kind. */
export const checkpointRef = (kind: CheckpointKind, runId: string, n: number) =>
	`${prefixOf(kind, runId)}${n}`;

/** Every checkpoint.restore@1 adapter MUST pass these tests, for each kind it restores. */
export const checkpointRestoreContract = (
	name: string,
	open: CheckpointRestoreHarness,
	kinds: readonly CheckpointKind[] = ["git", "snapshot"],
) => {
	for (const kind of kinds) kindContract(name, open, kind);
};

const codeOf = async (
	adapter: CheckpointRestoreAdapter,
	input: RunCheckpoint,
) => {
	const r = await adapter.restore(input);
	return r.ok ? "ok" : r.error.code;
};

const kindContract = (
	name: string,
	open: CheckpointRestoreHarness,
	kind: CheckpointKind,
) =>
	describe(`checkpoint.restore@1 contract: ${name} (${kind})`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const setup = async () => {
			const h = await open(kind);
			close = h.close;
			return h;
		};

		it("restores a paused run's checkpoint after recording the state before it, and says so", async () => {
			const { adapter, events, paused } = await setup();
			const before = events.length;
			const r = await adapter.restore(paused);
			if (!r.ok) throw new Error(r.error.message);
			expect(r.value.ref).toBe(paused.ref);
			const undo = r.value.undo;
			expect(undo.startsWith(prefixOf(kind, paused.runId))).toBe(true);
			expect(Number(undo.slice(undo.lastIndexOf("/") + 1))).toBeGreaterThan(0);
			expect(undo).not.toBe(paused.ref);
			const published = events.slice(before);
			expect(published.map((e) => [e.type, e.runId])).toEqual([
				["checkpoint.created", paused.runId],
				["rollback.performed", paused.runId],
			]);
			expect(published[0]?.payload).toEqual({ kind, ref: undo });
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
			const unknown = checkpointRef(kind, UNKNOWN, 1);
			expect(
				await codeOf(adapter, { ...paused, runId: UNKNOWN, ref: unknown }),
			).toBe("not_found");
			expect(await codeOf(adapter, running)).toBe("run_active");
			expect(events.slice(before)).toEqual([]);
		});

		it("answers not_found for a checkpoint that is not kept", async () => {
			const { adapter, paused } = await setup();
			const ref = checkpointRef(kind, paused.runId, 999);
			expect(await codeOf(adapter, { ...paused, ref })).toBe("not_found");
		});
	});
