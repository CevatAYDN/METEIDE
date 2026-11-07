import { randomUUID } from "node:crypto";
import { ok, type SecretsMaskAdapter } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

describe("thread lifecycle", () => {
	it("counts async thread admission in quiescence and refuses all later sends", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		h.registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
			id: "mask",
			trust: "core",
			features: [],
			impl: { mask: async (text) => ({ text, masked: 0 }) },
		});
		try {
			const pending = h.thread.start({
				requestId: randomUUID(),
				goal: "hello",
			});
			expect(await h.quiesce.prepare()).toMatchObject({ ok: false });
			const start = await pending;
			if (!start.ok) throw new Error(start.error.message);
			await vi.waitFor(() =>
				expect(h.engine.status(start.value.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			expect(await h.quiesce.prepare()).toEqual(ok(null));
			expect(
				await h.thread.start({ requestId: randomUUID(), goal: "later" }),
			).toMatchObject({ ok: false });
			expect(
				await h.thread.reply({
					conversationId: start.value.runId,
					expectedRunId: start.value.runId,
					requestId: randomUUID(),
					message: "later",
				}),
			).toMatchObject({ ok: false });
			expect(await h.thread.read({ runId: start.value.runId })).toMatchObject({
				ok: true,
			});
			expect(h.store.list()).toHaveLength(1);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("retains a failed preparation receipt after restart without creating or driving a duplicate", async () => {
		const input = { requestId: randomUUID(), goal: "hello" };
		const first = engineHarness({
			scripts: [reply("unused")],
			tools: [
				[
					"fs.list@1",
					async () => {
						throw new Error("interrupted context");
					},
				],
			],
		});
		expect(await first.thread.start(input)).toMatchObject({ ok: false });
		const root = first.store.list()[0];
		if (!root) throw new Error("queued run");
		expect(first.events.some((event) => event.type === "run.failed")).toBe(
			true,
		);
		await first.stop();
		const h = engineHarness({ scripts: [reply("unused")], db: first.db });
		try {
			h.recover();
			expect(await h.thread.start(input)).toEqual(
				ok({ conversationId: root.id, runId: root.id }),
			);
			expect(h.store.list()).toHaveLength(1);
			expect(h.requests).toEqual([]);
			expect(h.engine.status(root.id)).toMatchObject({
				value: [{ status: "failed" }],
			});
			h.store.remove(root.id);
			expect(await h.thread.start(input)).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("retains external taint and tools while adopting only the selected legacy predecessor", async () => {
		const h = engineHarness({
			scripts: [
				reply("", [
					{ name: "web_fetch", args: { url: "https://example.test" } },
				]),
				reply("done"),
			],
			tools: [
				[
					"web.fetch@1",
					async () =>
						ok({
							markdown: "external",
							title: "page",
							finalUrl: "https://example.test",
						}),
				],
			],
		});
		try {
			const first = await h.conversation.start({
				goal: "same",
				capabilities: ["web.fetch@1"],
			});
			if (!first.ok) throw new Error(first.error.message);
			await vi.waitFor(() =>
				expect(h.engine.status(first.value.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			const before = h.store.load(first.value.runId);
			const turn = await h.thread.reply({
				conversationId: first.value.runId,
				expectedRunId: first.value.runId,
				requestId: randomUUID(),
				message: "next",
			});
			if (!turn.ok) throw new Error(turn.error.message);
			await vi.waitFor(() =>
				expect(h.engine.status(turn.value.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			expect(h.store.load(turn.value.runId)?.snapshot.context).toMatchObject({
				tainted: true,
				extraCapabilities: ["web.fetch@1"],
			});
			expect(h.store.load(first.value.runId)).toEqual(before);
			expect(
				h.store.threads.members(first.value.runId).map((turn) => turn.runId),
			).toEqual([first.value.runId, turn.value.runId]);
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
