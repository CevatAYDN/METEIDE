import { randomUUID } from "node:crypto";
import { ok, type ToolContext } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

describe("committed conversation preparation", () => {
	it("does not start workspace tools when cancellation answers the initial created event", async () => {
		const tool = vi.fn(async () => ok({ paths: [] }));
		const h = engineHarness({
			scripts: [reply("must not run")],
			tools: [["fs.list@1", tool]],
		});
		h.bus.subscribe("run.created", (event) => {
			if (event.runId) void h.engine.cancel(event.runId);
		});
		try {
			expect(
				await h.thread.start({
					requestId: randomUUID(),
					goal: "cancel immediately",
				}),
			).toMatchObject({ ok: false });
			expect(tool).not.toHaveBeenCalled();
			expect(h.requests).toEqual([]);
			expect(h.store.list()[0]?.status).toBe("cancelled");
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it.each([false, true])(
		"never undoes cancellation or removal=%s after a slow workspace read",
		async (remove) => {
			let release = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let context: ToolContext | undefined;
			const h = engineHarness({
				scripts: [reply("must not run")],
				tools: [
					[
						"fs.list@1",
						async (_input, ctx) => {
							context = ctx;
							await gate;
							return ok({ paths: [] });
						},
					],
				],
			});
			const input = {
				requestId: randomUUID(),
				goal: "cancel during preparation",
			};
			try {
				const starting = h.thread.start(input);
				await vi.waitFor(() => expect(context).toBeDefined());
				const id = h.store.list()[0]?.id;
				if (!id) throw new Error("admitted run missing");
				expect((await h.engine.cancel(id)).ok).toBe(true);
				expect(context?.signal.aborted).toBe(true);
				const removing = remove ? h.engine.remove?.(id) : undefined;
				release();
				expect(await starting).toMatchObject({ ok: false });
				if (removing) expect((await removing).ok).toBe(true);
				expect(h.requests).toEqual([]);
				expect(h.events.some((event) => event.type === "run.started")).toBe(
					false,
				);
				if (remove) {
					expect(h.store.list()).toEqual([]);
					expect(await h.thread.start(input)).toMatchObject({
						ok: false,
						error: { code: "not_found" },
					});
				} else {
					expect(h.store.list()[0]?.status).toBe("cancelled");
					expect(await h.thread.start(input)).toEqual(
						ok({ conversationId: id, runId: id }),
					);
				}
			} finally {
				release();
				await h.stop();
				h.db.close();
			}
		},
	);

	it("settles a known preparation error without restart or an inert queued receipt", async () => {
		const h = engineHarness({
			scripts: [reply("must not run")],
			tools: [
				[
					"fs.list@1",
					async () => {
						throw new Error("PRIVATE_FILE_ERROR");
					},
				],
			],
		});
		const input = { requestId: randomUUID(), goal: "preparation error" };
		try {
			expect(await h.thread.start(input)).toMatchObject({
				ok: false,
				error: { code: "failed" },
			});
			const run = h.store.list()[0];
			expect(run?.status).toBe("failed");
			expect(await h.thread.start(input)).toEqual(
				ok({ conversationId: run?.id, runId: run?.id }),
			);
			expect(h.store.list()).toHaveLength(1);
			expect(h.requests).toEqual([]);
			expect(await h.quiesce.prepare()).toEqual(ok(null));
			expect(JSON.stringify(h.events)).not.toContain("PRIVATE_FILE_ERROR");
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
