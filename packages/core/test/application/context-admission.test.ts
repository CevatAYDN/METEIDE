import { randomUUID } from "node:crypto";
import { err, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { contextPorts, draft, preview } from "../helpers/context.js";
import { engineHarness, reply } from "../helpers/engine.js";

const completed = async (h: ReturnType<typeof engineHarness>, id: string) =>
	vi.waitFor(() =>
		expect(h.engine.status(id)).toMatchObject({
			value: [{ status: "completed" }],
		}),
	);

describe("context intent admission", () => {
	it("replays an exact receipt before changed disk or masking, with no new launch", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		let allowed = true;
		const inspect = vi.fn(async () =>
			allowed
				? ok({ path: "src/a.ts" })
				: err({ code: "ignored" as const, message: "private-text" }),
		);
		const ports = contextPorts(h, inspect);
		try {
			const attachment = await preview(h);
			const input = {
				requestId: randomUUID(),
				goal: "review",
				attachments: [attachment],
			};
			const sent = await h.threadContext.start(input);
			if (!sent.ok) throw new Error("start refused");
			await completed(h, sent.value.runId);
			allowed = false;
			ports.masking.dispose();
			const inspected = inspect.mock.calls.length;
			expect(await h.threadContext.start(input)).toEqual(sent);
			expect(inspect).toHaveBeenCalledTimes(inspected);
			expect(h.requests).toHaveLength(1);
			expect(
				await h.threadContext.start({
					...input,
					attachments: [{ ...attachment, modified: false }],
				}),
			).toMatchObject({ ok: false, error: { code: "bad_input" } });
			expect(
				await h.thread.start({
					requestId: input.requestId,
					goal: input.goal,
				}),
			).toMatchObject({ ok: false, error: { code: "bad_input" } });
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it.each(["path", "mask", "hash", "source"])(
		"refuses a changed %s before any run",
		async (change) => {
			const h = engineHarness({ scripts: [reply("must not run")] });
			let changed = false;
			contextPorts(
				h,
				async () =>
					change === "source" && changed
						? err({ code: "ignored", message: "private-text" })
						: ok({
								path: change === "path" && changed ? "src/b.ts" : "src/a.ts",
							}),
				async (text) => ({
					text: change === "mask" && changed ? "[MASKED]" : text,
					masked: 0,
				}),
			);
			try {
				const attachment = await preview(h);
				changed = true;
				const result = await h.threadContext.start({
					requestId: randomUUID(),
					goal: "review",
					attachments: [
						{
							...attachment,
							sha256: change === "hash" ? "0".repeat(64) : attachment.sha256,
						},
					],
				});
				expect(result).toMatchObject({ ok: false });
				expect(JSON.stringify(result)).not.toContain("private-text");
				expect(h.store.list()).toEqual([]);
				expect(h.events).toEqual([]);
				expect(h.requests).toEqual([]);
			} finally {
				await h.stop();
				h.db.close();
			}
		},
	);

	it("shares legacy receipts for empty context and admits one @1/@2 competing reply", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		contextPorts(h);
		try {
			const input = { requestId: randomUUID(), goal: "review" };
			const sent = await h.threadContext.start(input);
			if (!sent.ok) throw new Error("start refused");
			expect(await h.thread.start(input)).toEqual(sent);
			await completed(h, sent.value.runId);
			const attachment = await preview(h);
			const head = {
				conversationId: sent.value.conversationId,
				expectedRunId: sent.value.runId,
			};
			const replies = await Promise.all([
				h.threadContext.reply({
					...head,
					requestId: randomUUID(),
					message: "attached",
					attachments: [attachment],
				}),
				h.thread.reply({ ...head, requestId: randomUUID(), message: "plain" }),
			]);
			expect(replies.filter((result) => result.ok)).toHaveLength(1);
			expect(replies.filter((result) => !result.ok)).toMatchObject([
				{ error: { code: "invalid_state" } },
			]);
			expect(h.store.list()).toHaveLength(2);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("rolls back attachments with a refused initial receipt transaction", async () => {
		const h = engineHarness({ scripts: [reply("must not run")] });
		contextPorts(h);
		h.db.exec(
			"CREATE TRIGGER refuse_context BEFORE INSERT ON conversation_receipts BEGIN SELECT RAISE(ABORT, 'private-text'); END",
		);
		try {
			const attachment = await preview(h);
			expect(
				await h.threadContext.start({
					requestId: randomUUID(),
					goal: "review",
					attachments: [attachment],
				}),
			).toMatchObject({ ok: false, error: { code: "failed" } });
			expect(h.store.list()).toEqual([]);
			expect(h.store.threads.links()).toEqual([]);
			expect(h.events).toEqual([]);
			expect(h.requests).toEqual([]);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("records snapshots before run.created and never launches an immediately cancelled admission", async () => {
		const h = engineHarness({ scripts: [reply("must not run")] });
		contextPorts(h);
		const attachment = await preview(h);
		h.bus.subscribe("run.created", (event) => {
			if (!event.runId) throw new Error("missing run");
			expect(h.store.load(event.runId)?.snapshot.context.attachments).toEqual([
				attachment,
			]);
			expect(h.store.threads.membership(event.runId)).toBeDefined();
			void h.engine.cancel(event.runId);
		});
		try {
			expect(
				await h.threadContext.start({
					requestId: randomUUID(),
					goal: "review",
					attachments: [attachment],
				}),
			).toMatchObject({ ok: false });
			expect(h.store.list()[0]?.status).toBe("cancelled");
			expect(h.requests).toEqual([]);
			expect(JSON.stringify(h.events)).not.toContain(draft.content);
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
