import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	draftOf,
	edited,
	issuesOf,
	teamOf,
	type WorkView,
} from "../src/application/team-draft.js";
import { attemptsEdit, Work } from "../src/application/work-fields.js";

// A task's best-of-N attempts in the team editor (ADR-162 (9)): the count, then, from 2 on, the
// family tick and the judge's tier.

const loaded = draftOf(
	readFileSync(
		join(__dirname, "..", "..", "..", "templates", "web-dev.yaml"),
		"utf8",
	),
);
if (!loaded.ok) throw new Error(loaded.error);
const DOC = loaded.value;
const BEST = {
	n: 3,
	distinct_families: true,
	judge_tier: "fast",
} as const;

const render = (work: WorkView) =>
	renderToStaticMarkup(
		createElement(Work, {
			team: teamOf(DOC),
			work,
			base: ["tasks", 0],
			hints: [],
			onEdit: () => {},
		}),
	);

describe("a task's attempts", () => {
	it("writes the whole object when the count first reaches 2, then only the count, and drops the key below 2", () => {
		expect(attemptsEdit(undefined, 2)).toEqual({
			key: [],
			value: { n: 2, distinct_families: false, judge_tier: "reasoning" },
		});
		expect(attemptsEdit(BEST, 4)).toEqual({ key: ["n"], value: 4 });
		for (const n of [undefined, 0, 1])
			expect(attemptsEdit(BEST, n)).toEqual({ key: [], value: undefined });
	});

	it("reads attempts from the file, and the edit gives a template the schema takes", () => {
		const best = edited(DOC, ["tasks", 0, "attempts"], BEST);
		expect(teamOf(best).tasks[0]?.attempts).toEqual(BEST);
		expect(issuesOf(best)).toEqual([]);
		expect(teamOf(DOC).tasks[0]?.attempts).toBeUndefined();
	});

	it("shows the family tick and the judge's tier only once a task has attempts, its tier pressed", () => {
		const once = render({ verify: [] });
		expect(once).toContain("Attempts");
		expect(once).not.toContain("Judge&#x27;s model tier");
		const best = render({ verify: [], attempts: BEST });
		expect(best).toContain(
			'<input type="checkbox" checked=""/>Each attempt after the first uses another model family',
		);
		expect(best).toContain("Judge&#x27;s model tier");
		expect(best).toMatch(/aria-pressed="true"[^>]*>.*?<span>Fast<\/span>/);
		expect(best).toContain('value="3"');
	});
});
