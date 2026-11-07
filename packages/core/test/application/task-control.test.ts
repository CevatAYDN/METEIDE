import type { SecretsMaskAdapter, TaskPending } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlHarness } from "../helpers/task-control.js";

let held: ReturnType<typeof controlHarness> | undefined;
afterEach(async () => {
	await held?.stop();
	held?.db.close();
	held = undefined;
});
const approve = (request: TaskPending) => ({
	runId: request.runId,
	taskId: request.taskId,
	requestId: request.requestId,
	decision: "approve" as const,
});
const first = async (h: ReturnType<typeof controlHarness>) => {
	const result = await h.tasks.pending({ runId: h.runId });
	if (!result.ok || !result.value.requests[0])
		throw new Error("missing pending fixture");
	return result.value.requests[0];
};

describe("exact task controls", () => {
	it("persists stable identities for two independent waiting tasks", async () => {
		held = controlHarness();
		const h = held;
		const one = await h.tasks.pending({ runId: h.runId });
		const two = await h.tasks.pending({ runId: h.runId });
		expect(one).toEqual(two);
		if (!one.ok) throw new Error("missing pending");
		expect(one.value.requests.map((r) => r.templateTaskId)).toEqual(["a", "b"]);
		expect(new Set(one.value.requests.map((r) => r.requestId)).size).toBe(2);
		expect(
			h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.wait?.request
				.requestId,
		).toBe(one.value.requests[0]?.requestId);
	});

	it("rejects wrong-run, cross-task and duplicate answers without moving the peer", async () => {
		held = controlHarness("user");
		const h = held;
		const request = await first(h);
		const peer = h.store.load(h.runId)?.snapshot.context.team?.tasks.b;
		if (!peer) throw new Error("missing peer");
		expect(
			(
				await h.tasks.answer({
					...approve(request),
					runId: crypto.randomUUID(),
				})
			).ok,
		).toBe(false);
		expect(
			(await h.tasks.answer({ ...approve(request), taskId: peer.id })).ok,
		).toBe(false);
		const results = await Promise.all([
			h.tasks.answer(approve(request)),
			h.tasks.answer(approve(request)),
		]);
		expect(results.filter((r) => r.ok)).toHaveLength(1);
		const snapshot = h.store.load(h.runId)?.snapshot;
		expect(snapshot?.context.team?.tasks.a?.status).toBe("approved");
		expect(snapshot?.context.team?.tasks.b?.status).toBe("submitted");
		expect(snapshot?.value).toBe("paused");
		expect(snapshot?.context.pause?.reason).toBe("user");
	});

	it("rejects an old pending request after cancellation", async () => {
		held = controlHarness();
		const h = held;
		const request = await first(h);
		expect((await h.engine.cancel(h.runId)).ok).toBe(true);
		expect((await h.tasks.answer(approve(request))).ok).toBe(false);
		expect(await h.tasks.pending({ runId: h.runId })).toEqual({
			ok: true,
			value: { requests: [] },
		});
	});

	it("does not publish an already answered request after delayed masking", async () => {
		held = controlHarness("user");
		const h = held;
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
			id: "mask",
			trust: "core",
			features: [],
			impl: {
				mask: async (text) => {
					await gate;
					return { text, masked: 0 };
				},
			},
		});
		const reading = h.tasks.pending({ runId: h.runId });
		await vi.waitFor(() =>
			expect(
				h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.wait,
			).toBeDefined(),
		);
		const request = h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.wait
			?.request;
		if (!request) throw new Error("pending request missing");
		try {
			expect((await h.tasks.answer(approve(request))).ok).toBe(true);
		} finally {
			release();
		}
		const result = await reading;
		expect(
			result.ok && result.value.requests.map((r) => r.templateTaskId),
		).toEqual(["b"]);
	});
});
