import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { MeteShownRun } from "../src/infrastructure/shown-run.js";

// The run the Team panel shows (ADR-078): readers hear each change, and only a change.

describe("the shown run", () => {
	it("starts with none and fires once for each new run", () => {
		const shown = new MeteShownRun();
		const heard: (string | undefined)[] = [];
		shown.onDidChange(() => heard.push(shown.runId));
		expect(shown.runId).toBeUndefined();
		shown.set("r1");
		shown.set("r2");
		shown.set(undefined);
		expect(heard).toEqual(["r1", "r2", undefined]);
	});

	it("stays quiet when the same run is set again", () => {
		const shown = new MeteShownRun();
		let fired = 0;
		shown.onDidChange(() => fired++);
		shown.set(undefined);
		shown.set("r1");
		shown.set("r1");
		expect(fired).toBe(1);
		expect(shown.runId).toBe("r1");
	});
});
