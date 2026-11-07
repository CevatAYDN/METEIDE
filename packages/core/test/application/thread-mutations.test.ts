import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

const completed = async (h: ReturnType<typeof engineHarness>, id: string) =>
	vi.waitFor(() =>
		expect(h.engine.status(id)).toMatchObject({
			value: [{ status: "completed" }],
		}),
	);

describe("thread intent identity", () => {
	it("replays normalized starts concurrently and after restart, rejecting changed intent", async () => {
		const first = engineHarness({ scripts: [reply("done")] });
		const requestId = randomUUID();
		const input = {
			requestId,
			goal: " hello ",
			capabilities: ["web.fetch@1", "web.search@1"] as const,
		};
		const send = { ...input, capabilities: [...input.capabilities] };
		const [a, b] = await Promise.all([
			first.thread.start(send),
			first.thread.start(send),
		]);
		expect(a).toEqual(b);
		if (!a.ok) throw new Error(a.error.message);
		await completed(first, a.value.runId);
		await first.stop();
		const h = engineHarness({ scripts: [reply("unused")], db: first.db });
		try {
			expect(
				await h.thread.start({
					requestId,
					goal: "hello",
					capabilities: ["web.search@1", "web.fetch@1"],
				}),
			).toEqual(a);
			expect(
				await h.thread.start({ requestId, goal: "different" }),
			).toMatchObject({ ok: false, error: { code: "bad_input" } });
			expect(h.requests).toEqual([]);
			expect(h.store.list()).toHaveLength(1);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("admits one competing head intent, preserves the predecessor, and replays replies", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		try {
			const start = await h.thread.start({
				requestId: randomUUID(),
				goal: "hello",
				capabilities: ["web.fetch@1"],
			});
			if (!start.ok) throw new Error(start.error.message);
			await completed(h, start.value.runId);
			const before = h.store.load(start.value.runId);
			const source = {
				conversationId: start.value.conversationId,
				expectedRunId: start.value.runId,
			};
			const a = { ...source, requestId: randomUUID(), message: "next" };
			const b = { ...source, requestId: randomUUID(), message: "other" };
			const results = await Promise.all([h.thread.reply(a), h.thread.reply(b)]);
			expect(results.filter((r) => r.ok)).toHaveLength(1);
			expect(results.filter((r) => !r.ok)).toMatchObject([
				{ error: { code: "invalid_state" } },
			]);
			const winner = results[0];
			if (!winner?.ok) throw new Error("first intent");
			await completed(h, winner.value.runId);
			expect(await h.thread.reply(a)).toEqual(winner);
			expect(await h.thread.reply({ ...a, message: "changed" })).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
			expect(h.store.load(start.value.runId)).toEqual(before);
			expect(
				h.store.load(winner.value.runId)?.snapshot.context.extraCapabilities,
			).toEqual(["web.fetch@1"]);
			expect(h.requests[1]?.messages.at(-1)).toEqual({
				role: "user",
				content: "next",
			});
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("does not reply to a non-completed head", async () => {
		const h = engineHarness({ scripts: [], llm: false });
		try {
			const start = await h.thread.start({
				requestId: randomUUID(),
				goal: "hello",
			});
			if (!start.ok) throw new Error(start.error.message);
			await vi.waitFor(() =>
				expect(h.engine.status(start.value.runId)).toMatchObject({
					value: [{ status: "paused" }],
				}),
			);
			expect(
				await h.thread.reply({
					conversationId: start.value.conversationId,
					expectedRunId: start.value.runId,
					requestId: randomUUID(),
					message: "next",
				}),
			).toMatchObject({
				ok: false,
				error: { code: "invalid_state", status: "paused" },
			});
			expect(h.store.list()).toHaveLength(1);
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
