import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { optionsOf } from "../src/application/composer.js";
import {
	type ComposerInput,
	type ComposerModel,
	ComposerView,
} from "../src/application/composer-view.js";

// The composer screen rendered to HTML on Node: no DOM and no Theia widget (ADR-071).

const OPTIONS = optionsOf(
	[{ id: "web-dev", name: "Web development", description: "Sites" }],
	[
		{
			ok: true,
			value: {
				providers: [{ providerId: "groq", requests: 15 }],
				unassigned: 0,
			},
		},
		undefined,
	],
);
const READY: ComposerModel = { kind: "ready", options: OPTIONS, unsure: false };
const INPUT: ComposerInput = { goal: "", selected: "choose", busy: false };

const html = (model: ComposerModel, input: Partial<ComposerInput> = {}) =>
	renderToStaticMarkup(
		createElement(ComposerView, {
			model,
			...INPUT,
			...input,
			onGoal: () => {},
			onSelect: () => {},
			onStart: () => {},
			onEdit: () => {},
			onNewTeam: () => {},
		}),
	);

describe("ComposerView", () => {
	it("shows the goal field, every option with its description and estimate, and Start", () => {
		const out = html(READY);
		expect(out).toContain("<textarea");
		expect(out).toContain("What should METE do in this folder?");
		for (const text of [
			"Let METE choose",
			"Web development",
			"Sites",
			"15 requests",
			"groq 15",
			"tasks the team adds come on top",
			"Single agent",
			"New team",
			"Start run",
		])
			expect(out).toContain(text);
		expect(out.match(/type="radio"/g)).toHaveLength(3);
	});

	// The Composer board (ADR-128): a grid of team cards under a heading with New team, each team's
	// Edit inside its card. A button inside a label is not valid HTML, so Edit is the label's sibling.
	it("draws each team as a card with its Edit beside the label, under a heading with New team", () => {
		const out = html(READY);
		expect(out).toMatch(
			/<div class="mete-composer-team"><label class="[^"]*mete-composer-option[^"]*"><span class="mete-composer-head">.*?Web development.*?<\/label><button type="button" class="[^"]*mete-composer-edit[^"]*" aria-label="Edit Web development">/,
		);
		expect(out).toMatch(/role="radiogroup" aria-labelledby="[^"]+"/);
		expect(out.indexOf("New team")).toBeLessThan(
			out.indexOf("Let METE choose"),
		);
		const teams = out.slice(
			out.indexOf('<section class="mete-composer-teams"'),
		);
		expect(teams.slice(0, teams.indexOf("</section>"))).not.toContain("style=");
	});

	it("shows an estimate as its total and one chip per share, what no provider takes marked", () => {
		const options = optionsOf(
			[{ id: "web-dev", name: "Web development" }],
			[
				{
					ok: true,
					value: {
						providers: [{ providerId: "groq", requests: 15 }],
						unassigned: 4,
					},
				},
			],
		);
		expect(html({ kind: "ready", options, unsure: false })).toContain(
			'<span class="mete-composer-estimate"><span class="mete-composer-total">19 requests</span><span class="mete-composer-share">groq 15</span><span class="mete-composer-share unassigned">4 unassigned</span><span class="mete-composer-note">tasks the team adds come on top</span></span>',
		);
	});

	// The design's goal box (docs/design/Composer.dc.html) shows an example goal; an empty box left
	// users asking where to type.
	it("shows an example goal in the empty goal field", () => {
		expect(html(READY)).toContain(
			'placeholder="Add a dark mode toggle to the settings page.',
		);
	});

	it("checks the picked option only", () => {
		const out = html(READY, { selected: "web-dev" });
		expect(out.match(/checked=""/g)).toHaveLength(1);
	});

	it("keeps Start disabled while the goal is blank or a start is in flight, and says so", () => {
		const disabled = (out: string) => /<button[^>]*disabled/.test(out);
		expect(disabled(html(READY))).toBe(true);
		expect(disabled(html(READY, { goal: "   " }))).toBe(true);
		expect(disabled(html(READY, { goal: "build it" }))).toBe(false);
		const busy = html(READY, { goal: "build it", busy: true });
		expect(disabled(busy)).toBe(true);
		expect(busy).toContain("METE is starting the run…");
		expect(html(READY, { goal: "build it" })).not.toContain("starting the run");
	});

	it("tells the user the router is unsure and lists only what it narrowed to", () => {
		const out = html({
			kind: "ready",
			options: OPTIONS.slice(1),
			unsure: true,
		});
		expect(out).toContain(
			"METE is not sure which team fits this goal; choose one",
		);
		expect(out).not.toContain("Let METE choose");
		expect(html(READY)).not.toContain("not sure");
	});

	it("shows an error inline as an alert, as it is", () => {
		const out = html(READY, { error: "The METE daemon stopped: C:\\x <b>" });
		expect(out).toContain('role="alert"');
		expect(out).toContain("C:\\x &lt;b&gt;");
	});

	it("says what it waits for or lacks instead of the form", () => {
		expect(html({ kind: "loading" })).toContain("estimating the requests");
		expect(html({ kind: "no_folder" })).toContain("Open a folder first");
		expect(html({ kind: "no_folder" })).not.toContain("<textarea");
	});

	it("renders preferred model field with datalist when single agent is selected", () => {
		const singleOptions = optionsOf(
			[],
			[undefined],
			["groq/llama-3.3-70b-versatile", "gemini/gemini-2.0-flash"],
		);
		const out = html(
			{ kind: "ready", options: singleOptions, unsure: false },
			{ selected: "single", singleModel: "groq/llama-3.3-70b-versatile" },
		);
		expect(out).toContain("Preferred model (optional)");
		expect(out).toContain('value="groq/llama-3.3-70b-versatile"');
		expect(out).toContain('value="gemini/gemini-2.0-flash"');
		expect(out).toContain("<datalist");
	});

	it("renders preferred model fields per role when a team is selected", () => {
		const teamOptions = optionsOf(
			[
				{
					id: "web-dev",
					name: "Web development",
					roles: [
						{
							id: "lead",
							name: "Lead",
							models: ["groq/llama-3.3-70b-versatile"],
						},
						{
							id: "dev",
							name: "Developer",
							models: ["gemini/gemini-2.0-flash"],
						},
					],
				},
			],
			[undefined, undefined],
		);
		const out = html(
			{ kind: "ready", options: teamOptions, unsure: false },
			{
				selected: "web-dev",
				roleModels: { lead: "groq/llama-3.3-70b-versatile" },
			},
		);
		expect(out).toContain("Lead · Preferred model (optional)");
		expect(out).toContain("Developer · Preferred model (optional)");
		expect(out).toContain('value="groq/llama-3.3-70b-versatile"');
	});

	it("omits preferred model inputs when Let METE choose is selected", () => {
		const out = html(READY, { selected: "choose" });
		expect(out).not.toContain("Preferred model (optional)");
	});

	it("counts the folder's uncommitted changes for a team or Let METE choose, which a team's worktree does not hold (ADR-156)", () => {
		const line =
			"A team starts from the last commit, so its members do not see them; commit them first if the team needs them.";
		for (const selected of ["choose", "web-dev"]) {
			const out = html(READY, { selected, uncommitted: 3 });
			expect(out).toContain(`This folder has 3 uncommitted changes. ${line}`);
		}
		expect(html(READY, { selected: "web-dev", uncommitted: 1 })).toContain(
			`This folder has 1 uncommitted change. ${line}`,
		);
		// The single agent works in the folder itself; a clean folder needs no line.
		expect(html(READY, { selected: "single", uncommitted: 3 })).not.toContain(
			line,
		);
		expect(html(READY, { selected: "web-dev", uncommitted: 0 })).not.toContain(
			line,
		);
		expect(html(READY, { selected: "web-dev" })).not.toContain(line);
	});
});
