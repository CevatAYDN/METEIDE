import { randomUUID } from "node:crypto";
import {
	type SecretsMaskAdapter,
	ThreadReadResultSchema,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

const open = () => {
	const h = engineHarness({ scripts: [reply("model-only-text")] });
	h.registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
		id: "mask",
		trust: "core",
		features: [],
		impl: {
			mask: async (text) => ({
				text: text.replaceAll("secret", "[MASK]"),
				masked: 0,
			}),
		},
	});
	return h;
};
const done = async (h: ReturnType<typeof open>, id: string) =>
	vi.waitFor(() =>
		expect(h.engine.status(id)).toMatchObject({
			value: [{ status: "completed" }],
		}),
	);
const start = async (h: ReturnType<typeof open>, goal = "hello") => {
	const input = { requestId: randomUUID(), goal };
	const r = await h.thread.start(input);
	if (!r.ok) throw new Error(r.error.message);
	await done(h, r.value.runId);
	return { ...r.value, input };
};

const barrier = () => {
	let enter = () => {};
	let release = () => {};
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { enter, release, entered, wait };
};

describe("retained masked conversation reads", () => {
	it("keeps a continuation cursor when a collected match is removed during a limited page", async () => {
		const h = open();
		const masking = barrier();
		try {
			const oldest = await start(h, "oldest-match");
			h.clock.now++;
			const middle = await start(h, "middle-match");
			h.clock.now++;
			const newest = await start(h, "newest-match");
			const chain = h.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
			if (!chain.ok) throw new Error("mask");
			const original = chain.value[0].impl.mask;
			chain.value[0].impl.mask = async (text) => {
				if (text === "middle-match") {
					masking.enter();
					await masking.wait;
				}
				return original(text);
			};
			const pending = h.thread.list({ query: "match", limit: 1 });
			await masking.entered;
			await h.engine.remove?.(newest.runId);
			masking.release();
			const page = await pending;
			if (!page.ok) throw new Error(page.error.message);
			expect(page.value.conversations.map((row) => row.id)).toEqual([
				middle.runId,
			]);
			expect(page.value.nextCursor).toBeDefined();
			const next = await h.thread.list({
				query: "match",
				limit: 1,
				cursor: page.value.nextCursor,
			});
			expect(next).toMatchObject({
				value: { conversations: [{ id: oldest.runId }] },
			});
		} finally {
			masking.release();
			await h.stop();
			h.db.close();
		}
	});

	it("does not match an appended then removed message outside the captured membership", async () => {
		const h = open();
		const title = barrier();
		const message = barrier();
		try {
			const first = await start(h, "captured-root");
			const mask = h.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
			if (!mask.ok) throw new Error("mask");
			const original = mask.value[0].impl.mask;
			mask.value[0].impl.mask = async (text) => {
				const held =
					text === "captured-root"
						? title
						: text === "late-needle"
							? message
							: undefined;
				if (held) {
					held.enter();
					await held.wait;
				}
				return original(text);
			};
			const search = h.thread.list({ query: "late-needle" });
			await title.entered;
			const next = await h.thread.reply({
				conversationId: first.runId,
				expectedRunId: first.runId,
				requestId: randomUUID(),
				message: "late-needle",
			});
			if (!next.ok) throw new Error(next.error.message);
			await done(h, next.value.runId);
			title.release();
			// A snapshot-correct read finishes without consuming the newly appended message.
			await Promise.race([message.entered, search]);
			expect(await h.engine.remove?.(next.value.runId)).toMatchObject({
				ok: true,
			});
			message.release();
			expect(await search).toMatchObject({
				ok: true,
				value: { conversations: [] },
			});
		} finally {
			title.release();
			message.release();
			await h.stop();
			h.db.close();
		}
	});

	it("revalidates an earlier match after another candidate finishes masking", async () => {
		const h = open();
		const later = barrier();
		try {
			const older = await start(h, "older-match");
			h.clock.now++;
			const newer = await start(h, "newer-match");
			const mask = h.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
			if (!mask.ok) throw new Error("mask");
			const original = mask.value[0].impl.mask;
			mask.value[0].impl.mask = async (text) => {
				if (text === "older-match") {
					later.enter();
					await later.wait;
				}
				return original(text);
			};
			const search = h.thread.list({ query: "match" });
			await later.entered;
			expect(await h.engine.remove?.(newer.runId)).toMatchObject({ ok: true });
			later.release();
			const result = await search;
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.conversations.map((row) => row.id)).toEqual([
				older.runId,
			]);
		} finally {
			later.release();
			await h.stop();
			h.db.close();
		}
	});

	it("does not return a search match removed while masking is pending", async () => {
		const h = open();
		let release = () => {};
		let entered = () => {};
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		const masking = new Promise<void>((resolve) => {
			entered = resolve;
		});
		try {
			const first = await start(h);
			const turn = await h.thread.reply({
				conversationId: first.runId,
				expectedRunId: first.runId,
				requestId: randomUUID(),
				message: "pending-needle",
			});
			if (!turn.ok) throw new Error(turn.error.message);
			await done(h, turn.value.runId);
			const prior = h.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
			if (!prior.ok) throw new Error("mask");
			const original = prior.value[0].impl.mask;
			prior.value[0].impl.mask = async (text) => {
				if (text === "pending-needle") {
					entered();
					await wait;
				}
				return original(text);
			};
			const search = h.thread.list({ query: "pending-needle" });
			await masking;
			await h.engine.remove?.(turn.value.runId);
			release();
			expect(await search).toMatchObject({ value: { conversations: [] } });
		} finally {
			release();
			await h.stop();
			h.db.close();
		}
	});

	it("reads ordered turns and searches only masked titles and new-port authored messages", async () => {
		const h = open();
		try {
			const first = await start(h, "hello secret");
			const next = await h.thread.reply({
				...first,
				expectedRunId: first.runId,
				requestId: randomUUID(),
				message: "needle secret",
			});
			// Public boundaries reject the extra fields above; use the exact input.
			expect(next).toMatchObject({ ok: false, error: { code: "bad_input" } });
			const turn = await h.thread.reply({
				conversationId: first.conversationId,
				expectedRunId: first.runId,
				requestId: randomUUID(),
				message: "needle secret",
			});
			if (!turn.ok) throw new Error(turn.error.message);
			await done(h, turn.value.runId);
			const read = await h.thread.read({ runId: first.runId });
			if (!read.ok) throw new Error(read.error.message);
			expect(ThreadReadResultSchema.safeParse(read.value).success).toBe(true);
			expect(read.value.turns.map((t) => t.id)).toEqual([
				first.runId,
				turn.value.runId,
			]);
			expect(read.value.conversation).toMatchObject({
				id: first.runId,
				title: "hello [MASK]",
				head: { id: turn.value.runId },
				turnCount: 2,
			});
			for (const query of ["secret", "model-only-text", "' OR 1=1 --"])
				expect(await h.thread.list({ query })).toMatchObject({
					value: { conversations: [] },
				});
			expect(await h.thread.list({ query: "NEEDLE" })).toMatchObject({
				value: { conversations: [{ id: first.runId }] },
			});
			h.db.exec("UPDATE runs SET snapshot = 'damaged'");
			expect(await h.thread.list({})).toMatchObject({
				ok: true,
				value: { conversations: [{ turnCount: 2 }] },
			});
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("paginates equal timestamps by id and keeps legacy replies as independent singletons", async () => {
		const h = open();
		try {
			const a = await h.conversation.start({ goal: "same title" });
			if (!a.ok) throw new Error(a.error.message);
			await done(h, a.value.runId);
			const b = await h.reply.reply({
				runId: a.value.runId,
				message: "legacy-only-needle",
			});
			if (!b.ok) throw new Error(b.error.message);
			await done(h, b.value.runId);
			const ids = [a.value.runId, b.value.runId].sort().reverse();
			const page = await h.thread.list({ limit: 1 });
			if (!page.ok || !page.value.nextCursor) throw new Error("page");
			expect(page.value.conversations.map((c) => c.id)).toEqual(
				ids.slice(0, 1),
			);
			const next = await h.thread.list({
				limit: 1,
				cursor: page.value.nextCursor,
			});
			expect(next).toMatchObject({
				value: { conversations: [{ id: ids[1], turnCount: 1 }] },
			});
			expect(
				await h.thread.list({ query: "legacy-only-needle" }),
			).toMatchObject({ value: { conversations: [] } });
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("removes only retained runs, moves head backward, and never resurrects deleted receipts", async () => {
		const h = open();
		try {
			const first = await start(h);
			const input = {
				conversationId: first.runId,
				expectedRunId: first.runId,
				requestId: randomUUID(),
				message: "delete-needle",
			};
			const turn = await h.thread.reply(input);
			if (!turn.ok) throw new Error(turn.error.message);
			await done(h, turn.value.runId);
			expect(await h.engine.remove?.(turn.value.runId)).toMatchObject({
				ok: true,
			});
			expect(await h.thread.reply(input)).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
			expect(await h.thread.list({ query: "delete-needle" })).toMatchObject({
				value: { conversations: [] },
			});
			const read = await h.thread.read({ runId: first.runId });
			expect(read).toMatchObject({
				value: {
					conversation: { head: { id: first.runId }, turnCount: 1 },
					turns: [{ id: first.runId }],
				},
			});
			await h.engine.remove?.(first.runId);
			expect(await h.thread.start(first.input)).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
			expect(await h.thread.list({})).toMatchObject({
				value: { conversations: [] },
			});
			expect(await h.thread.read({ runId: first.runId })).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
