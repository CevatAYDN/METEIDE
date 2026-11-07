import { randomUUID } from "node:crypto";
import { ok } from "@mete/contracts";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

it.each(["commit", "context"])(
	"recovers a queued database image at %s without duplicate admission",
	async (boundary) => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
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
					if (result.ok) {
						expect(first.events).toEqual([]);
						expect(first.db.inTransaction).toBe(false);
						committed = first.db.serialize();
					}
					return result;
				},
			}),
			tools: [
				[
					"fs.list@1",
					async () => {
						entered = true;
						await gate;
						return ok({ paths: [] });
					},
				],
			],
		});
		let later: ReturnType<typeof engineHarness> | undefined;
		try {
			const input = {
				requestId: randomUUID(),
				goal: "recover committed intent",
			};
			const pending = first.thread.start(input);
			await vi.waitFor(() => expect(entered).toBe(true));
			const id = first.store.list()[0]?.id;
			if (!id) throw new Error("queued run missing");
			expect(first.store.load(id)?.snapshot.value).toBe("queued");
			const image = boundary === "commit" ? committed : first.db.serialize();
			if (!image) throw new Error("committed database image missing");
			const stopping = first.stop();
			release();
			await pending;
			await stopping;
			// A fresh SQLite connection opens the committed image, never the graceful-stop result.
			const database = new Database(image);
			const tool = vi.fn(async () => ok({ paths: [] }));
			later = engineHarness({
				scripts: [reply("recovered once")],
				db: database,
				workspaceId,
				tools: [["fs.list@1", tool]],
			});
			later.recover();
			expect(later.store.list()[0]?.status).toBe("paused");
			expect(await later.thread.start(input)).toEqual(
				ok({ conversationId: id, runId: id }),
			);
			expect(later.requests).toEqual([]);
			expect(tool).not.toHaveBeenCalled();
			expect(later.store.list()).toHaveLength(1);
			expect(later.store.threads.members(id)).toHaveLength(1);
			expect(
				await later.thread.start({ ...input, goal: "changed request" }),
			).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
			expect((await later.engine.resume(id)).ok).toBe(true);
			await vi.waitFor(() =>
				expect(later?.store.list()[0]?.status).toBe("completed"),
			);
			expect(later.requests).toHaveLength(1);
			expect(first.requests).toEqual([]);
		} finally {
			release();
			await first.stop();
			await later?.stop();
			later?.db.close();
			first.db.close();
		}
	},
);
