import { randomUUID } from "node:crypto";
import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { contextPorts, preview } from "../helpers/context.js";
import { engineHarness, reply } from "../helpers/engine.js";

describe("context admission lifecycle", () => {
	it.each([false, true])(
		"cannot resurrect a cancelled admission after removal=%s",
		async (remove) => {
			let release = () => {};
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			let entered = false;
			const h = engineHarness({
				scripts: [reply("must not run")],
				tools: [
					[
						"fs.list@1",
						async () => {
							entered = true;
							await wait;
							return ok({ paths: [] });
						},
					],
				],
			});
			contextPorts(h);
			try {
				const attachment = await preview(h);
				const input = {
					requestId: randomUUID(),
					goal: "review",
					attachments: [attachment],
				};
				const sending = h.threadContext.start(input);
				await vi.waitFor(() => expect(entered).toBe(true));
				const id = h.store.list()[0]?.id;
				if (!id) throw new Error("missing admission");
				expect((await h.engine.cancel(id)).ok).toBe(true);
				const removing = remove ? h.engine.remove?.(id) : undefined;
				release();
				expect(await sending).toMatchObject({ ok: false });
				await removing;
				expect(h.requests).toEqual([]);
				if (remove) {
					expect(await h.threadContext.context({ runId: id })).toMatchObject({
						ok: false,
					});
					expect(await h.threadContext.start(input)).toMatchObject({
						ok: false,
						error: { code: "not_found" },
					});
					expect(h.store.list()).toEqual([]);
				}
			} finally {
				release();
				await h.stop();
				h.db.close();
			}
		},
	);

	it("refuses quiescence during source validation and refuses late admission after stop", async () => {
		const h = engineHarness({ scripts: [reply("must not run")] });
		let release = () => {};
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		let delayed = false;
		let entered = false;
		contextPorts(h, async () => {
			if (delayed) {
				entered = true;
				await wait;
			}
			return ok({ path: "src/a.ts" });
		});
		try {
			const attachment = await preview(h);
			delayed = true;
			const sending = h.threadContext.start({
				requestId: randomUUID(),
				goal: "review",
				attachments: [attachment],
			});
			await vi.waitFor(() => expect(entered).toBe(true));
			expect(await h.quiesce.prepare()).toMatchObject({ ok: false });
			await h.stop();
			release();
			expect(await sending).toMatchObject({ ok: false });
			expect(h.store.list()).toEqual([]);
			expect(h.requests).toEqual([]);
		} finally {
			release();
			await h.stop();
			h.db.close();
		}
	});
});
