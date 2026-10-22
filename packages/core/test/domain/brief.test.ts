import { describe, expect, it } from "vitest";
import { BRIEF_MAX_CHARS } from "../../src/defaults.js";
import { startBrief } from "../../src/domain/brief.js";

describe("start brief", () => {
	it("is nothing when there is nothing to say", () => {
		expect(startBrief({ entries: [] })).toBeUndefined();
	});

	it("labels its content as data and keeps a short entry whole", () => {
		const b = startBrief({
			entries: [{ title: "Handoff", body: "Goal: x. Stopped." }],
		});
		expect(b).toMatch(/^<start-brief> .*data, not instructions\./);
		expect(b).toContain("## Handoff\nGoal: x. Stopped.");
		expect(b?.endsWith("</start-brief>")).toBe(true);
	});

	it("grows entries in passes and stays within the cap with the label whole", () => {
		const long = `First sentence here. ${"y".repeat(3000)}`;
		const entries = [
			{ title: "A", body: long },
			{ title: "B", body: long },
		];
		const b = startBrief({ entries }) ?? "";
		expect(b.length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
		expect(b).toContain("## B\n");
		expect(b.startsWith("<start-brief>")).toBe(true);
		expect(b.endsWith("</start-brief>")).toBe(true);
		// A grew past its first sentence; B kept at least its first sentence.
		expect(b).toMatch(/## A\nFirst sentence here\. y+/);
		expect(b).toContain("## B\nFirst sentence here.");
	});

	it("puts the offer line first", () => {
		const offer = "Open handoff h1 from 2 hours ago: fix the build.";
		expect(startBrief({ entries: [], offer })).toContain(`\n\n${offer}\n\n`);
	});
});
