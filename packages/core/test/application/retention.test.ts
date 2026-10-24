import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { pruneOldCheckpoints } from "../../src/application/retention.js";
import { CHECKPOINT_KEEP_DAYS } from "../../src/defaults.js";
import type { SnapshotStore } from "../../src/infrastructure/snapshot-store.js";
import {
	engineHarness,
	recordingLogger,
	reply,
	T0,
} from "../helpers/engine.js";

// Old runs' checkpoints go (SECURITY.md: kept 14 days after the run ends); recent and live runs keep theirs.

const DAY = 86_400_000;
const pruned = () => ok({ op: "checkpoint.prune", removed: 1 });

const finishedRun = async () => {
	const vcs = vi.fn(async () => pruned());
	const h = engineHarness({
		scripts: [reply("done")],
		tools: [["vcs.git@2", vcs]],
	});
	const r = await h.engine.start({ goal: "say done" });
	if (!r.ok) throw new Error(r.error.message);
	await vi.waitFor(() =>
		expect(
			h.engine.status(r.value.runId).ok && h.engine.status(r.value.runId),
		).toMatchObject({ value: [{ status: "completed" }] }),
	);
	vcs.mockClear();
	return { h, vcs, runId: r.value.runId };
};

const sweep = (h: ReturnType<typeof engineHarness>, days: number) =>
	pruneOldCheckpoints({
		registry: h.registry,
		store: h.store,
		now: () => T0 + days * DAY,
		logger: recordingLogger().logger,
	});

describe("checkpoint retention", () => {
	it("prunes the checkpoints of a run that ended more than the kept days ago", async () => {
		const { h, vcs, runId } = await finishedRun();
		await sweep(h, CHECKPOINT_KEEP_DAYS + 1);
		expect(vcs).toHaveBeenCalledWith(
			{ op: "checkpoint.prune", runId },
			expect.objectContaining({ runId }),
		);
	});

	it("keeps a run's checkpoints until then", async () => {
		const { h, vcs } = await finishedRun();
		await sweep(h, CHECKPOINT_KEEP_DAYS - 1);
		expect(vcs).not.toHaveBeenCalled();
	});

	it("does nothing without vcs.git@2 and snapshots", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		await expect(sweep(h, CHECKPOINT_KEEP_DAYS + 1)).resolves.toBeUndefined();
	});

	it("prunes an old run's file snapshots without vcs.git@2 too (ADR-080), and keeps a recent run's", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		const r = await h.engine.start({ goal: "say done" });
		if (!r.ok) throw new Error(r.error.message);
		await vi.waitFor(() =>
			expect(h.engine.status(r.value.runId)).toMatchObject({
				value: [{ status: "completed" }],
			}),
		);
		const prune = vi.fn(async () => {});
		const swept = (days: number) =>
			pruneOldCheckpoints({
				registry: h.registry,
				store: h.store,
				now: () => T0 + days * DAY,
				logger: recordingLogger().logger,
				snapshots: { prune } as unknown as SnapshotStore,
			});
		await swept(CHECKPOINT_KEEP_DAYS - 1);
		expect(prune).not.toHaveBeenCalled();
		await swept(CHECKPOINT_KEEP_DAYS + 1);
		expect(prune).toHaveBeenCalledWith(r.value.runId);
	});
});
