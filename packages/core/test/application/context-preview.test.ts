import { createHash } from "node:crypto";
import { err } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { contextPorts, draft, preview } from "../helpers/context.js";
import { engineHarness } from "../helpers/engine.js";

const attachmentBytes = 32 * 1024; // ADR-183's independent fixture boundary.

describe("explicit context preview", () => {
	it("returns the canonical masked fixed copy with an ordered SHA-256", async () => {
		const h = engineHarness({ scripts: [] });
		contextPorts(h, undefined, async () => ({ text: "[MASKED]", masked: 1 }));
		try {
			const input = { ...draft };
			const snapshot = await preview(h, input);
			const json =
				'{"path":"src/a.ts","content":"[MASKED]","modified":true,"range":{"start":{"line":2,"character":1},"end":{"line":2,"character":13}}}';
			expect(snapshot).toEqual({
				...draft,
				path: "src/a.ts",
				content: "[MASKED]",
				sha256: createHash("sha256").update(json).digest("hex"),
			});
			input.content = "later edit";
			expect(snapshot.content).toBe("[MASKED]");
			expect(h.store.list()).toEqual([]);
			expect(h.requests).toEqual([]);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("fails closed for missing inspection or masking", async () => {
		const h = engineHarness({ scripts: [] });
		try {
			expect(await h.threadContext.prepare(draft)).toMatchObject({
				ok: false,
				error: { code: "not_supported" },
			});
			const ports = contextPorts(h);
			ports.masking.dispose();
			expect(await h.threadContext.prepare(draft)).toMatchObject({
				ok: false,
				error: { code: "not_supported" },
			});
			expect(h.store.list()).toEqual([]);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("refuses input and post-mask overflow, invalid Unicode and source failures without leaking text", async () => {
		const h = engineHarness({ scripts: [] });
		const inspect = vi.fn(async () =>
			err({ code: "io" as const, message: "private-text" }),
		);
		let ports = contextPorts(h, inspect);
		try {
			for (const content of [
				"",
				"\0",
				"\ud800",
				"x".repeat(attachmentBytes + 1),
			]) {
				expect(
					await h.threadContext.prepare({ ...draft, content }),
				).toMatchObject({ ok: false });
			}
			expect(inspect).not.toHaveBeenCalled();
			expect(
				JSON.stringify(await h.threadContext.prepare(draft)),
			).not.toContain("private-text");
			ports.source.dispose();
			ports.masking.dispose();
			ports = contextPorts(h, undefined, async () => ({
				text: "x".repeat(attachmentBytes + 1),
				masked: 1,
			}));
			expect(await h.threadContext.prepare(draft)).toMatchObject({ ok: false });
			expect(h.events).toEqual([]);
			expect(h.requests).toEqual([]);
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
