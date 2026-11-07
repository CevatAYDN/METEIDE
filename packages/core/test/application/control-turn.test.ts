import { describe, expect, it } from "vitest";
import {
	type ControlState,
	controlTurn,
	progressOrControl,
	runTurn,
} from "../../src/application/control-turn.js";

describe("run control turn", () => {
	it("wakes a waiting scheduler and serializes the human decision before its next turn", async () => {
		const live: ControlState = {};
		const order: string[] = [];
		let entered = () => {};
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const scheduler = runTurn(live, async () => {
			entered();
			await progressOrControl(live, new Promise<void>(() => {}));
			order.push("scheduler released");
		});
		await ready;
		const control = controlTurn(live, () => {
			order.push("answered");
			return "ok";
		});
		const next = runTurn(live, () => {
			order.push("next step");
		});
		await Promise.all([scheduler, control, next]);
		expect(order).toEqual(["scheduler released", "answered", "next step"]);
	});

	it("does not lose an answer queued before the scheduler begins waiting", async () => {
		const live: ControlState = {};
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const scheduler = runTurn(live, async () => {
			await hold;
			await progressOrControl(live, new Promise<void>(() => {}));
		});
		const answer = controlTurn(live, () => 42);
		release();
		await scheduler;
		expect(await answer).toBe(42);
		expect(live.controlQueued).toBe(0);
	});

	it("releases the queue after a rejected operation without swallowing its exception", async () => {
		const live: ControlState = {};
		await expect(
			controlTurn(live, () => {
				throw new Error("fixture");
			}),
		).rejects.toThrow("fixture");
		expect(await runTurn(live, () => 42)).toBe(42);
	});
});
