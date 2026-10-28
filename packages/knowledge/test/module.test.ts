import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { day, setup, WS } from "./setup.js";

// The vault module's run reports (docs/11, Run reports; ADR-144).

let n = 0;
const ev = <T extends MeteEvent["type"]>(
	runId: string,
	type: T,
	payload: Extract<MeteEvent, { type: T }>["payload"],
	ts = "2026-10-28T09:30:00.000Z",
) =>
	({
		id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
		ts,
		schema: 1,
		workspaceId: WS,
		runId,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const tick = () => new Promise((r) => setImmediate(r));

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// The core publishes the handoff right after the ending event, in the same call (docs/08).
const finish = (
	s: Awaited<ReturnType<typeof setup>>,
	runId: string,
	goal: string,
) => {
	s.publish(ev(runId, "run.created", { templateId: null, goal }));
	s.publish(ev(runId, "run.completed", { summary: "Done." }));
	s.publish(
		ev(runId, "handoff.created", {
			handoffId: "22222222-2222-4222-8222-222222222222",
			files: ["index.html"],
		}),
	);
};

describe("vault module", () => {
	it("writes an ended run's report with the files of the handoff published after it", async () => {
		const s = await setup();
		finish(s, RUN_A, "Build a page");
		await tick();
		await s.mod.deactivate();
		const d = day("2026-10-28T09:30:00.000Z");
		const text = await s.note(d);
		expect(text).toMatch(
			new RegExp(
				`^---\\ntype: journal\\ntitle: Journal ${d}\\ncreated: 2026-10-28T12:00:00.000Z\\n`,
			),
		);
		expect(text).toContain(`source: run/${RUN_A}\n`);
		expect(text).toContain("## Build a page\n");
		expect(text).toContain("- Changed files: `index.html`\n");
		expect(s.saved.map((e) => [e.runId, e.source, e.payload])).toEqual([
			[
				RUN_A,
				"vault",
				{ path: `.mete/knowledge/journal/${d}.md`, noteType: "journal" },
			],
		]);
	});

	it("appends a later run to the day's note under one frontmatter", async () => {
		const s = await setup();
		finish(s, RUN_A, "First");
		await tick();
		finish(s, RUN_B, "Second");
		await s.mod.deactivate();
		const text = await s.note(day("2026-10-28T09:30:00.000Z"));
		expect(text.match(/^---$/gm)).toHaveLength(2);
		expect(text.indexOf("## First")).toBeLessThan(text.indexOf("## Second"));
		expect(s.saved).toHaveLength(2);
	});

	// Stop all cancels every run in one call (ADR-065): each report still lands in the day's note.
	it("keeps every report of runs that end together", async () => {
		const s = await setup();
		finish(s, RUN_A, "First");
		finish(s, RUN_B, "Second");
		await tick();
		await s.mod.deactivate();
		const text = await s.note(day("2026-10-28T09:30:00.000Z"));
		expect(text.match(/^---$/gm)).toHaveLength(2);
		expect(text).toContain("## First");
		expect(text).toContain("## Second");
	});

	it("writes the report of a run that ends right before a stop", async () => {
		const s = await setup();
		finish(s, RUN_A, "Stopped soon");
		await s.mod.deactivate();
		expect(await s.note(day("2026-10-28T09:30:00.000Z"))).toContain(
			"## Stopped soon",
		);
	});

	it("logs a report whose events cannot be read and writes nothing", async () => {
		const s = await setup(() => {
			throw new Error("The database connection is not open");
		});
		finish(s, RUN_A, "Lost");
		await s.mod.deactivate();
		expect(s.errors).toEqual(["run report not written"]);
		expect(s.saved).toEqual([]);
		await expect(s.note(day("2026-10-28T09:30:00.000Z"))).rejects.toThrow();
	});

	it("leaves paused runs alone", async () => {
		const s = await setup();
		s.publish(ev(RUN_A, "run.paused", { reason: "user" }));
		await tick();
		await s.mod.deactivate();
		expect(s.saved).toEqual([]);
	});
});
