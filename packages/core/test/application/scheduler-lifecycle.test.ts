import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";
import {
	errorReply,
	gatedReply,
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilRequests,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
afterEach(async () => {
	await held?.cleanup();
	held = undefined;
});

describe("parallel scheduler lifecycle", () => {
	it("resumes both task sessions without accepting late replies or model chunks from paused workers", async () => {
		const oldA = gatedReply("stale-a");
		const oldB = gatedReply("stale-b");
		const a = gatedReply("a");
		const b = gatedReply("b");
		held = await schedulerHarness({
			scripts: [
				oldA.script,
				oldB.script,
				a.script,
				b.script,
				reply("c"),
				reply("d"),
			],
		});
		const h = held;
		await untilRequests(h, 2);
		const agents = stateOf(h)?.context.team;
		expect((await h.engine.pause(h.runId)).ok).toBe(true);
		expect(stateOf(h)?.context.reservations).toEqual([]);
		expect((await h.engine.resume(h.runId)).ok).toBe(true);
		await untilRequests(h, 4);
		oldA.release();
		oldB.release();
		a.release();
		b.release();
		await untilStatus(h, "completed");
		const tasks = stateOf(h)?.context.team?.tasks;
		expect(tasks?.a?.context.report).toBe("a");
		expect(tasks?.b?.context.report).toBe("b");
		expect(tasks?.a?.context.agentId).toBe(agents?.tasks.a?.context.agentId);
		expect(tasks?.b?.context.agentId).toBe(agents?.tasks.b?.context.agentId);
		expect(
			Object.values(tasks ?? {})
				.flatMap((t) => t.messages)
				.filter(
					(m) => m.role === "assistant" && m.content.startsWith("stale-"),
				),
		).toEqual([]);
		expect(stateOf(h)?.context.requests).toBe(4);
	});

	it("cancels every pending model and ignores completions after cancellation", async () => {
		const a = gatedReply("late-a");
		const b = gatedReply("late-b");
		held = await schedulerHarness({ scripts: [a.script, b.script] });
		const h = held;
		await untilRequests(h, 2);
		expect((await h.engine.cancel(h.runId)).ok).toBe(true);
		await untilStatus(h, "cancelled");
		a.release();
		b.release();
		await h.stop();
		expect(h.requests).toHaveLength(2);
		expect(stateOf(h)?.context).toMatchObject({
			requests: 0,
			reservations: [],
		});
		expect(
			Object.values(stateOf(h)?.context.team?.tasks ?? {})
				.flatMap((t) => t.messages)
				.filter((m) => m.role === "assistant" && m.content.startsWith("late-")),
		).toEqual([]);
	});

	it.each(["network", "no_model"] as const)(
		"releases %s failures, aborts peers, and retains completed task progress for restart",
		async (code) => {
			const b = gatedReply("late");
			held = await schedulerHarness({
				scripts: [reply("a"), b.script, errorReply(code)],
			});
			const h = held;
			await untilStatus(h, "paused");
			expect(stateOf(h)?.context).toMatchObject({
				requests: 1,
				reservations: [],
				pause: { reason: code },
			});
			expect(stateOf(h)?.context.team?.tasks.a?.context.report).toBe("a");
			b.release();
			await h.stop();
			const later = engineHarness({
				scripts: [reply("b"), reply("c"), reply("d")],
				db: h.db,
				templates: h.templates,
			});
			later.recover();
			expect((await later.engine.resume(h.runId)).ok).toBe(true);
			await vi.waitFor(() =>
				expect(h.store.load(h.runId)?.snapshot.value).toBe("completed"),
			);
			expect(h.store.load(h.runId)?.snapshot.context.requests).toBe(4);
			expect(later.requests).toHaveLength(3);
			await later.stop();
		},
	);

	it("releases missing-model reservations without inventing billed requests", async () => {
		held = await schedulerHarness({ scripts: [], llm: false });
		const h = held;
		await untilStatus(h, "paused");
		expect(stateOf(h)?.context).toMatchObject({
			requests: 0,
			reservations: [],
			pause: { reason: "no_model" },
		});
	});
});
