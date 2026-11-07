import { randomUUID } from "node:crypto";
import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

describe("atomic thread admission", () => {
	it("commits run, membership and receipt before workspace tools or events", async () => {
		const requestId = randomUUID();
		const inspect = (runId: string) => {
			expect(h.db.inTransaction).toBe(false);
			expect(h.store.list(runId)).toHaveLength(1);
			expect(h.store.threads.membership(runId)?.conversationId).toBe(runId);
			expect(
				h.db
					.prepare(
						"SELECT run_id FROM conversation_receipts WHERE request_id = ?",
					)
					.get(requestId),
			).toEqual({ run_id: runId });
		};
		const h = engineHarness({
			scripts: [reply("done")],
			tools: [
				[
					"fs.list@1",
					async (_input, ctx) => {
						if (!ctx.runId) throw new Error("run id");
						inspect(ctx.runId);
						return ok({ paths: ["a.txt"] });
					},
				],
			],
		});
		h.bus.subscribe("run.created", (event) => {
			if (!event.runId) throw new Error("run id");
			inspect(event.runId);
		});
		try {
			const result = await h.thread.start({ requestId, goal: "hello" });
			if (!result.ok) throw new Error(result.error.message);
			await vi.waitFor(() =>
				expect(h.engine.status(result.value.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			expect(h.requests[0]?.messages).toContainEqual({
				role: "user",
				content: expect.stringContaining("a.txt"),
			});
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("rolls back a failed initial receipt save and starts no event, model or tool", async () => {
		const tool = vi.fn(async () => ok({ paths: [] }));
		const h = engineHarness({
			scripts: [reply("done")],
			tools: [["fs.list@1", tool]],
		});
		h.db.exec(
			"CREATE TRIGGER fail_receipt BEFORE INSERT ON conversation_receipts BEGIN SELECT RAISE(ABORT, 'receipt failed'); END",
		);
		try {
			expect(
				await h.thread.start({ requestId: randomUUID(), goal: "hello" }),
			).toMatchObject({ ok: false, error: { code: "failed" } });
			expect(h.store.list()).toEqual([]);
			expect(h.db.prepare("SELECT * FROM conversation_threads").all()).toEqual(
				[],
			);
			expect(h.db.prepare("SELECT * FROM conversation_turns").all()).toEqual(
				[],
			);
			expect(h.events).toEqual([]);
			expect(h.requests).toEqual([]);
			expect(tool).not.toHaveBeenCalled();
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
