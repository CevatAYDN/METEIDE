import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TeamTemplateSchema } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpawnDefaults } from "../src/application/member-tasks.js";
import {
	draftOf,
	edited,
	issuesOf,
	teamOf,
	withRuns,
} from "../src/application/team-draft.js";
import { attemptsEdit, Work } from "../src/application/work-fields.js";

const loaded = draftOf(
	readFileSync(
		join(__dirname, "..", "..", "..", "templates", "game-studio.yaml"),
		"utf8",
	),
);
if (!loaded.ok) throw new Error(loaded.error);
const DOC = loaded.value;
const none = () => {};

describe("advanced task settings (F5)", () => {
	it("groups verify, review and best-of-N in a closed native disclosure without editing the draft", () => {
		const team = teamOf(DOC);
		const work = team.spawn_defaults.developer;
		if (!work) throw new Error("missing developer defaults");
		const before = DOC.toString();
		let edits = 0;
		const html = renderToStaticMarkup(
			createElement(Work, {
				team,
				work,
				base: ["spawn_defaults", "developer"],
				hints: [],
				onEdit: () => {
					edits++;
				},
			}),
		);
		const advanced = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
		expect(advanced).toContain(
			"<summary>Advanced: verify, review and best-of-N</summary>",
		);
		expect(advanced).not.toMatch(/<details[^>]*\bopen=/);
		for (const label of [
			"Commands that must pass",
			"Reviewed first by",
			"Attempts",
		])
			expect(advanced).toContain(label);
		expect(html.indexOf("Approved by")).toBeLessThan(html.indexOf("<details"));
		expect(edits).toBe(0);
		expect(DOC.toString()).toBe(before);
	});

	it("also makes advanced settings discoverable in a member's spawn defaults", () => {
		const html = renderToStaticMarkup(
			createElement(SpawnDefaults, {
				team: teamOf(DOC),
				id: "developer",
				hints: [],
				onEdit: none,
			}),
		);
		expect(html).toContain(
			"<summary>Advanced: verify, review and best-of-N</summary>",
		);
	});

	it("shows capability gates as read-only YAML, explicitly not evaluating expect", () => {
		const gate = {
			capability: "gameengine.build@1",
			args: { target: "web" },
			expect: { passed: true },
		};
		const html = renderToStaticMarkup(
			createElement(Work, {
				team: teamOf(DOC),
				work: { verify: [gate] },
				base: ["tasks", 0],
				hints: [],
				onEdit: none,
			}),
		);
		expect(html).toContain("Capability checks (YAML; expect is not evaluated)");
		expect(html).toMatch(/<textarea[^>]*readOnly=""/);
		expect(html).toContain("gameengine.build@1");
		expect(html).toContain("&quot;target&quot;: &quot;web&quot;");
	});

	it("disables pairing with the approver and keeps an invalid YAML pairing visible to validation", () => {
		const work = {
			verify: [],
			approval: "lead",
			review: { pair_with: "lead", max_turns: 7 },
		};
		const html = renderToStaticMarkup(
			createElement(Work, {
				team: teamOf(DOC),
				work,
				base: ["tasks", 0],
				hints: [],
				onEdit: none,
			}),
		);
		expect(html).toMatch(
			/<option value="lead" disabled="" selected="">Lead<\/option>/,
		);
		expect(
			issuesOf(edited(DOC, ["tasks", 0, "review"], work.review)).join("\n"),
		).toContain("the pair reviewer lead is also the approver");
	});

	it("roundtrips advanced form edits without dropping YAML-only fields or review limits", () => {
		let doc = edited(DOC, ["spawn_defaults", "developer", "review"], {
			pair_with: "tester",
			max_turns: 7,
		});
		doc = edited(
			doc,
			["spawn_defaults", "developer", "verify"],
			[
				{
					capability: "gameengine.build@1",
					args: { target: "web" },
					expect: { passed: true },
				},
				{ run: "npm test" },
			],
		);
		const original = TeamTemplateSchema.parse(doc.toJS());
		const defaults = original.spawn_defaults;
		const developer = defaults?.developer;
		if (!defaults || !developer) throw new Error("missing developer defaults");
		const base = ["spawn_defaults", "developer"];
		const change = attemptsEdit(undefined, 3);
		doc = edited(doc, [...base, "attempts", ...change.key], change.value);
		doc = edited(doc, [...base, "review", "pair_with"], "artist");
		doc = edited(
			doc,
			[...base, "verify"],
			withRuns(teamOf(doc).spawn_defaults.developer?.verify ?? [], [
				"npm run build",
			]),
		);
		const reopened = draftOf(doc.toString());
		if (!reopened.ok) throw new Error(reopened.error);
		expect(issuesOf(reopened.value)).toEqual([]);
		expect(TeamTemplateSchema.parse(reopened.value.toJS())).toEqual({
			...original,
			spawn_defaults: {
				...defaults,
				developer: {
					...developer,
					attempts: { n: 3, distinct_families: false, judge_tier: "reasoning" },
					review: { pair_with: "artist", max_turns: 7 },
					verify: [developer.verify?.[0], { run: "npm run build" }],
				},
			},
		});
		expect(reopened.value.toString()).toContain("# The game studio of docs/08");
	});
});
