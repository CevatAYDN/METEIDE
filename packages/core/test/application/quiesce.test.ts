import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

const deferred = () => {
	let release = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { wait, release };
};

describe("atomic idle restart gate", () => {
	it("makes concurrent prepare requests wait for the same paused tool drain", async () => {
		const tool = deferred();
		const entered = deferred();
		const h = engineHarness({
			scripts: [reply("", [{ name: "fs_read", args: { path: "a" } }])],
			tools: [
				[
					"fs.read@1",
					async () => {
						entered.release();
						await tool.wait;
						return ok({ content: "kept" });
					},
				],
			],
		});
		try {
			const start = await h.conversation.start({ goal: "read" });
			if (!start.ok) throw new Error(start.error.message);
			await entered.wait;
			await h.engine.pause(start.value.runId);
			const first = h.quiesce.prepare();
			const second = h.quiesce.prepare();
			expect(second).toBe(first);
			let finished = false;
			void second.then(() => {
				finished = true;
			});
			await Promise.resolve();
			expect(finished).toBe(false);
			expect(
				await h.restore.restore({
					runId: start.value.runId,
					checkpointId: "checkpoint",
					ref: `refs/mete/checkpoints/${start.value.runId}/1`,
				}),
			).toMatchObject({ ok: false, error: { code: "failed" } });
			expect(await h.engine.remove?.(start.value.runId)).toMatchObject({
				ok: false,
				error: { code: "failed" },
			});
			tool.release();
			expect(await first).toEqual(ok(null));
			expect(await second).toEqual(ok(null));
			expect(
				h.store.load(start.value.runId)?.snapshot.context.messages,
			).toContainEqual(
				expect.objectContaining({
					role: "tool",
					content: expect.stringContaining("kept"),
				}),
			);
		} finally {
			tool.release();
			await h.stop();
			h.db.close();
		}
	});

	it.each(["restore", "remove"] as const)(
		"refuses prepare while %s mutates files and refuses later mutations",
		async (operation) => {
			const mutation = deferred();
			const entered = deferred();
			const vcs = vi.fn(async () => {
				entered.release();
				await mutation.wait;
				return ok({ op: "checkpoint.create", ref: "undo", sha: "sha" });
			});
			const h = engineHarness({
				scripts: [reply("done")],
				tools: [["vcs.git@2", vcs]],
			});
			try {
				const start = await h.conversation.start({ goal: "hello" });
				if (!start.ok) throw new Error(start.error.message);
				const runId = start.value.runId;
				await vi.waitFor(() =>
					expect(h.engine.status(runId)).toMatchObject({
						value: [{ status: "completed" }],
					}),
				);
				const restore = () =>
					h.restore.restore({
						runId,
						checkpointId: crypto.randomUUID(),
						ref: `refs/mete/checkpoints/${runId}/1`,
					});
				const remove = () => h.engine.remove?.(runId);
				const pending = operation === "restore" ? restore() : remove();
				await entered.wait;
				expect(await h.quiesce.prepare()).toMatchObject({ ok: false });
				mutation.release();
				await pending;
				expect(await h.quiesce.prepare()).toEqual(ok(null));
				const calls = vcs.mock.calls.length;
				expect(await restore()).toMatchObject({
					ok: false,
					error: { code: "failed" },
				});
				expect(await remove()).toMatchObject({
					ok: false,
					error: { code: "failed" },
				});
				expect(vcs).toHaveBeenCalledTimes(calls);
			} finally {
				mutation.release();
				await h.stop();
				h.db.close();
			}
		},
	);

	it("blocks a restart racing an async start, then blocks new work once quiesced", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		try {
			const start = h.conversation.start({ goal: "hello" });
			expect(await h.quiesce.prepare()).toMatchObject({ ok: false });
			const result = await start;
			if (!result.ok) throw new Error(result.error.message);
			await vi.waitFor(() =>
				expect(h.engine.status(result.value.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			expect(await h.quiesce.prepare()).toEqual({ ok: true, value: null });
			expect(
				await h.engine.start({ goal: "too late", templateId: null }),
			).toMatchObject({ ok: false });
			expect(await h.conversation.start({ goal: "too late" })).toMatchObject({
				ok: false,
			});
			expect(
				await h.reply.reply({ runId: result.value.runId, message: "too late" }),
			).toMatchObject({ ok: false });
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
