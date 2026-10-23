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
			"15 requests: groq 15; tasks the team adds come on top",
			"Single agent",
			"Start run",
		])
			expect(out).toContain(text);
		expect(out.match(/type="radio"/g)).toHaveLength(3);
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
});
