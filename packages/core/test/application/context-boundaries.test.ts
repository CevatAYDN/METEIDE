import { randomUUID } from "node:crypto";
import { ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { contextPorts, draft, preview } from "../helpers/context.js";
import { engineHarness, reply } from "../helpers/engine.js";

const attachmentBytes = 32 * 1024; // ADR-183's independent fixture boundary.

it("refuses count and combined-byte overflow before source inspection", async () => {
	const h = engineHarness({ scripts: [reply("must not run")] });
	const inspect = vi.fn(async () => ok({ path: "src/a.ts" }));
	contextPorts(h, inspect);
	try {
		const small = await preview(h);
		const large = await preview(h, {
			...draft,
			content: "x".repeat(attachmentBytes),
		});
		inspect.mockClear();
		for (const attachments of [
			Array.from({ length: 5 }, () => small),
			[large, large, small],
		]) {
			expect(
				await h.threadContext.start({
					requestId: randomUUID(),
					goal: "review",
					attachments,
				}),
			).toMatchObject({ ok: false, error: { code: "bad_input" } });
		}
		expect(inspect).not.toHaveBeenCalled();
		expect(h.store.list()).toEqual([]);
		expect(h.requests).toEqual([]);
	} finally {
		await h.stop();
		h.db.close();
	}
});

it("includes attachment order and complete metadata in receipt identity", async () => {
	const h = engineHarness({ scripts: [reply("done")] });
	contextPorts(h);
	try {
		const a = await preview(h);
		const b = await preview(h, {
			...draft,
			content: "other-text",
			range: undefined,
		});
		const input = {
			requestId: randomUUID(),
			goal: "review",
			attachments: [a, b],
		};
		const sent = await h.threadContext.start(input);
		if (!sent.ok) throw new Error("start refused");
		await vi.waitFor(() => expect(h.store.list()[0]?.status).toBe("completed"));
		expect(
			await h.threadContext.start({ ...input, attachments: [b, a] }),
		).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
		expect(
			await h.threadContext.start({
				...input,
				attachments: [{ ...a, modified: false }, b],
			}),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(await h.threadContext.start(input)).toEqual(sent);
		expect(h.requests).toHaveLength(1);
	} finally {
		await h.stop();
		h.db.close();
	}
});

it("preserves a Unicode BOM in the explicitly supplied preview", async () => {
	const h = engineHarness({ scripts: [] });
	contextPorts(h);
	try {
		const snapshot = await preview(h, { ...draft, content: "\ufeffdirty" });
		expect(snapshot.content).toBe("\ufeffdirty");
	} finally {
		await h.stop();
		h.db.close();
	}
});
