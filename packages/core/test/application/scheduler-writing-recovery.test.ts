import { ok } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";
import {
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
let release = () => {};
afterEach(async () => {
	release();
	await held?.cleanup();
	held = undefined;
});

const writingHarness = async () => {
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let writes = 0;
	const h = await schedulerHarness({
		scripts: [
			reply("", [{ name: "fs_write", args: { path: "a.txt", content: "a" } }]),
			reply("a"),
			reply("b"),
			reply("c"),
			reply("d"),
		],
		rewrite: (source) =>
			source.replace("capabilities: []", "capabilities: [fs.write@1]"),
		tools: [
			[
				"fs.write@1",
				async () => {
					writes++;
					await gate;
					return ok({ bytes: 1 });
				},
			],
		],
	});
	held = h;
	await vi.waitFor(() => expect(writes).toBe(1));
	return { h, writes: () => writes };
};

describe("sequential team writer persistence inside the parallel driver", () => {
	it("persists checkpoint and writing marker before the tool finishes, then retains its result across immediate pause/resume", async () => {
		const { h, writes } = await writingHarness();
		const active = stateOf(h)?.context;
		expect(active?.inFlight).toBeTruthy();
		expect(active?.team?.tasks.a?.session?.inFlight).toBe(active?.inFlight);
		expect(active?.team?.tasks.a?.session?.checkpointed).toBe(
			active?.checkpointed,
		);
		await h.engine.pause(h.runId);
		expect((await h.engine.resume(h.runId)).ok).toBe(true);
		expect(stateOf(h)?.context.inFlight).toBe(active?.inFlight);
		expect(writes()).toBe(1);
		release();
		await untilStatus(h, "completed");
		expect(writes()).toBe(1);
		expect(
			stateOf(h)?.context.team?.tasks.a?.session?.inFlight,
		).toBeUndefined();
		expect(
			stateOf(h)?.context.team?.tasks.a?.messages.filter(
				(m) => m.role === "tool",
			),
		).toHaveLength(1);
	});

	it("recovers a user-paused team's crash-time write as INTERRUPTED and never replays it", async () => {
		const { h } = await writingHarness();
		await h.engine.pause(h.runId);
		const crash = h.store.load(h.runId);
		if (!crash?.snapshot.context.inFlight)
			throw new Error("missing durable write marker");
		// Stop the old process, then restore exactly the last durable crash-time row.
		release();
		await h.stop();
		h.store.save(crash.meta, crash.snapshot);
		let replayed = 0;
		const later = engineHarness({
			db: h.db,
			templates: h.templates,
			scripts: [reply("a"), reply("b"), reply("c"), reply("d")],
			tools: [
				[
					"fs.write@1",
					async () => {
						replayed++;
						return ok({ bytes: 1 });
					},
				],
			],
		});
		later.recover();
		const recovered = h.store.load(h.runId)?.snapshot.context;
		expect(recovered?.pause?.reason).toBe("user");
		expect(recovered?.inFlight).toBeUndefined();
		expect(recovered?.team?.tasks.a?.session?.inFlight).toBeUndefined();
		expect(recovered?.team?.tasks.a?.messages.at(-1)?.content).toContain(
			"whether it wrote is unknown",
		);
		expect((await later.engine.resume(h.runId)).ok).toBe(true);
		await vi.waitFor(() =>
			expect(h.store.load(h.runId)?.snapshot.value).toBe("completed"),
		);
		expect(replayed).toBe(0);
		expect(
			h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.messages.at(-2)
				?.content,
		).toContain("whether it wrote is unknown");
		await later.stop();
	});
});
