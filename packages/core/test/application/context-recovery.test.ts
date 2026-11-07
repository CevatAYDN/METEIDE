import { randomUUID } from "node:crypto";
import { ok } from "@mete/contracts";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { contextPorts, preview } from "../helpers/context.js";
import { engineHarness, reply } from "../helpers/engine.js";

it("recovers the atomic queued SQLite image with context and taint before any drive", async () => {
	let release = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = false;
	let committed: Buffer | undefined;
	const workspaceId = randomUUID();
	const first = engineHarness({
		workspaceId,
		scripts: [reply("must not run")],
		wrapStore: (store) => ({
			...store,
			saveInitial(meta, snapshot, intent) {
				const result = store.saveInitial(meta, snapshot, intent);
				if (result.ok) committed = first.db.serialize();
				return result;
			},
		}),
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
	contextPorts(first);
	let later: ReturnType<typeof engineHarness> | undefined;
	try {
		const attachment = await preview(first);
		const input = {
			requestId: randomUUID(),
			goal: "review",
			attachments: [attachment],
		};
		const sending = first.threadContext.start(input);
		await vi.waitFor(() => expect(entered).toBe(true));
		if (!committed) throw new Error("missing committed image");
		const stopping = first.stop();
		release();
		await sending;
		await stopping;
		later = engineHarness({
			scripts: [reply("recovered")],
			workspaceId,
			db: new Database(committed),
		});
		const h = later;
		contextPorts(h, async () => {
			throw new Error("source inspection must not replay");
		});
		h.recover();
		const id = h.store.list()[0]?.id;
		if (!id) throw new Error("missing recovered admission");
		expect(h.store.load(id)?.snapshot.context.attachments).toEqual([
			attachment,
		]);
		expect(h.store.load(id)?.snapshot.context.tainted).toBe(true);
		expect(h.store.list()[0]?.status).toBe("paused");
		expect(await h.threadContext.context({ runId: id })).toEqual(
			ok({ runId: id, attachments: [attachment] }),
		);
		expect(await h.threadContext.start(input)).toEqual(
			ok({ conversationId: id, runId: id }),
		);
		expect(h.requests).toEqual([]);
		expect((await h.engine.resume(id)).ok).toBe(true);
		await vi.waitFor(() => expect(h.store.list()[0]?.status).toBe("completed"));
		expect(h.requests[0]?.messages[2]).toMatchObject({
			role: "user",
			content: expect.stringContaining("private-text"),
		});
		expect(h.store.load(id)?.snapshot.context.attachments).toEqual([
			attachment,
		]);
		expect(first.requests).toEqual([]);
	} finally {
		release();
		await first.stop();
		await later?.stop();
		later?.db.close();
		first.db.close();
	}
});

it.each(["delete", "ownership"])(
	"rechecks %s while sent context is being masked",
	async (change) => {
		const h = engineHarness({ scripts: [reply("done")] });
		let release = () => {};
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		let delayed = false;
		let entered = false;
		contextPorts(h, undefined, async (text) => {
			if (delayed) {
				entered = true;
				await wait;
			}
			return { text, masked: 0 };
		});
		try {
			const attachment = await preview(h);
			const sent = await h.threadContext.start({
				requestId: randomUUID(),
				goal: "review",
				attachments: [attachment],
			});
			if (!sent.ok) throw new Error("start refused");
			await vi.waitFor(() =>
				expect(h.store.list()[0]?.status).toBe("completed"),
			);
			delayed = true;
			const reading = h.threadContext.context({ runId: sent.value.runId });
			await vi.waitFor(() => expect(entered).toBe(true));
			if (change === "delete") await h.engine.remove?.(sent.value.runId);
			else
				h.db
					.prepare("UPDATE runs SET workspace_id = ? WHERE id = ?")
					.run(randomUUID(), sent.value.runId);
			release();
			expect(await reading).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
		} finally {
			release();
			await h.stop();
			h.db.close();
		}
	},
);
