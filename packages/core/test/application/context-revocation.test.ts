import { randomUUID } from "node:crypto";
import { ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { contextPorts, preview } from "../helpers/context.js";
import { engineHarness, reply } from "../helpers/engine.js";

it.each([
	{ operation: "start", port: "source" },
	{ operation: "start", port: "masking" },
	{ operation: "reply", port: "source" },
	{ operation: "reply", port: "masking" },
] as const)(
	"refuses $operation when $port is revoked while validation awaits unwind",
	async ({ operation, port }) => {
		const h = engineHarness({ scripts: [reply("done")] });
		let revoke = false;
		const ports = contextPorts(h, undefined, async (text) => {
			if (revoke)
				queueMicrotask(() => queueMicrotask(() => ports[port].dispose()));
			return { text, masked: 0 };
		});
		try {
			const attachment = await preview(h);
			const source =
				operation === "reply"
					? await h.thread.start({ requestId: randomUUID(), goal: "original" })
					: undefined;
			if (source && !source.ok) throw new Error("source start refused");
			if (source?.ok)
				await vi.waitFor(() =>
					expect(h.store.list()[0]?.status).toBe("completed"),
				);
			const before = h.store.list();
			const events = h.events.length;
			const requests = h.requests.length;
			const requestId = randomUUID();
			revoke = true;
			const result = source?.ok
				? await h.threadContext.reply({
						conversationId: source.value.conversationId,
						expectedRunId: source.value.runId,
						requestId,
						message: "next",
						attachments: [attachment],
					})
				: await h.threadContext.start({
						requestId,
						goal: "review",
						attachments: [attachment],
					});
			expect(result).toMatchObject({ ok: false });
			expect(
				h.registry.has(port === "source" ? "fs.context@1" : "secrets.mask@1"),
			).toBe(false);
			expect(h.store.list()).toEqual(before);
			expect(h.events).toHaveLength(events);
			expect(h.requests).toHaveLength(requests);
			expect(
				h.db
					.prepare(
						"SELECT request_id FROM conversation_receipts WHERE request_id = ?",
					)
					.get(requestId),
			).toBeUndefined();
		} finally {
			await h.stop();
			h.db.close();
		}
	},
);

it("retains the original source identity across the entire attachment batch", async () => {
	const h = engineHarness({ scripts: [reply("must not run")] });
	let replace = false;
	let masked = 0;
	const inspect = vi.fn(async () => ok({ path: "src/a.ts" }));
	const ports = contextPorts(h, inspect, async (text) => {
		if (replace && ++masked === 1)
			queueMicrotask(() =>
				queueMicrotask(() => {
					ports.source.dispose();
					h.registry.provide("fs.context@1", {
						id: "replacement-source",
						trust: "core",
						features: [],
						impl: { inspect },
					});
				}),
			);
		return { text, masked: 0 };
	});
	try {
		const attachment = await preview(h);
		const requestId = randomUUID();
		replace = true;
		expect(
			await h.threadContext.start({
				requestId,
				goal: "review",
				attachments: [attachment, attachment],
			}),
		).toMatchObject({ ok: false });
		expect(h.registry.has("fs.context@1")).toBe(true);
		expect(h.store.list()).toEqual([]);
		expect(h.events).toEqual([]);
		expect(h.requests).toEqual([]);
		expect(
			h.db
				.prepare(
					"SELECT request_id FROM conversation_receipts WHERE request_id = ?",
				)
				.get(requestId),
		).toBeUndefined();
	} finally {
		await h.stop();
		h.db.close();
	}
});
