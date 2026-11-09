import { err, ok, type TeamEngineV3Adapter } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createNativeControls } from "../src/domain/native-controls.js";

const engine = (): TeamEngineV3Adapter => {
	const unsupported = async () =>
		err({ code: "not_supported" as const, message: "fixture" });
	return {
		start: unsupported,
		pause: unsupported,
		resume: unsupported,
		cancel: unsupported,
		approve: unsupported,
		status: () => ok([]),
	};
};

describe("current native controls", () => {
	it("accepts only the latest exact pair, never earlier or mixed activations", () => {
		const controls = createNativeControls();
		const first = {
			engine: engine(),
			quiesce: { prepare: async () => ok(null) },
		};
		const second = {
			engine: engine(),
			quiesce: { prepare: async () => ok(null) },
		};
		expect(controls.view.has(first.engine, first.quiesce)).toBe(false);
		controls.onNativeControls(first);
		expect(controls.view.has(first.engine, first.quiesce)).toBe(true);
		controls.onNativeControls(second);
		expect(controls.view.has(second.engine, second.quiesce)).toBe(true);
		expect(controls.view.has(first.engine, first.quiesce)).toBe(false);
		expect(controls.view.has(first.engine, second.quiesce)).toBe(false);
		expect(controls.view.has(second.engine, first.quiesce)).toBe(false);
	});

	it("exposes only a frozen read view and keeps workspaces independent", () => {
		const first = createNativeControls();
		const second = createNativeControls();
		const pair = {
			engine: engine(),
			quiesce: { prepare: async () => ok(null) },
		};
		first.onNativeControls(pair);
		expect(Object.keys(first.view)).toEqual(["has"]);
		expect(Object.isFrozen(first.view)).toBe(true);
		expect(second.view.has(pair.engine, pair.quiesce)).toBe(false);
	});
});
