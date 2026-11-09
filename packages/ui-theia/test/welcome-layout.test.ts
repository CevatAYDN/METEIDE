import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WelcomeView } from "../src/application/welcome-view.js";
import { required } from "./required-fixture.js";

// Source layout contracts only; Electron checks establish actual bounds, scrolling and focus.
const css = readFileSync(
	join(__dirname, "..", "style", "mete-welcome.css"),
	"utf8",
);
const rule = (selector: string) => {
	const start = css.indexOf(`${selector} {`);
	expect(start).toBeGreaterThanOrEqual(0);
	return css.slice(start, css.indexOf("}", start));
};
const none = () => {};

it("allocates the panel height to a shrinking setup body and an in-layout continuation row", () => {
	const root = rule(".mete-welcome");
	for (const declaration of [
		"display: grid",
		"grid-template-rows: minmax(0, 1fr) auto",
		"height: 100%",
		"box-sizing: border-box",
		"min-height: 0",
		"min-width: 0",
	])
		expect(root).toContain(declaration);
	const body = rule(".mete-welcome-body");
	for (const declaration of [
		"min-height: 0",
		"min-width: 0",
		"overflow: auto",
		"overscroll-behavior: contain",
	])
		expect(body).toContain(declaration);
	expect(rule(".mete-welcome-start")).not.toMatch(
		/position:\s*(fixed|absolute|sticky)/,
	);
});

it("keeps the setup and provider order intact while Start stays outside the focusable scroll region", () => {
	const view = WelcomeView({
		model: {
			kind: "keys",
			keys: [
				"provider-a",
				"provider-b",
				"provider-c",
				"provider-d",
				"provider-e",
			].map((id) => ({
				id,
				kind: "model",
				set: true,
				keyPage: `https://${id}.example/keys`,
			})),
		},
		workspaceOpen: true,
		keys: {
			stateOf: () => ({ key: "", busy: false }),
			onType: none,
			onSet: none,
			activeRuns: 0,
		},
		privacy: { kind: "no_folder" },
		actions: {
			onLanguage: none,
			onKeyPage: none,
			onStart: none,
			onCheck: none,
			onSettings: none,
		},
	});
	const children = Children.toArray(view.props.children);
	expect(children).toHaveLength(2);
	const body = required(children[0]);
	if (
		!isValidElement<{
			className: string;
			tabIndex: number;
			"aria-labelledby": string;
			children: ReactNode;
		}>(body)
	)
		throw new Error("Welcome setup region was not rendered");
	expect(body.props.className).toBe("mete-welcome-body");
	expect(body.props.tabIndex).toBe(0);
	expect(body.type).toBe("section");
	expect(body.props["aria-labelledby"]).toBe("mete-welcome-title");
	const markup = renderToStaticMarkup(body);
	expect(markup).toContain('id="mete-welcome-title"');
	const sequence = [
		'aria-labelledby="mete-step-1"',
		'aria-labelledby="mete-step-2"',
		"<strong>provider-a</strong>",
		"<strong>provider-b</strong>",
		"<strong>provider-c</strong>",
		"<strong>provider-d</strong>",
		"<strong>provider-e</strong>",
		'aria-labelledby="mete-step-3"',
		'aria-labelledby="mete-step-4"',
	];
	let previous = -1;
	for (const label of sequence) {
		const position = markup.indexOf(label);
		expect(position).toBeGreaterThan(previous);
		previous = position;
	}
	expect(markup).not.toContain("mete-welcome-start");
	const continuation = renderToStaticMarkup(required(children[1]));
	expect(continuation).toContain('class="mete-welcome-start"');
	expect(continuation).toContain("Start a run");
	expect(continuation).not.toContain('disabled=""');
});

it("fits the paired setup sections and continuation text within narrow panel tracks", () => {
	expect(rule(".mete-welcome-pair")).toContain("minmax(min(100%, 320px), 1fr)");
	expect(rule(".mete-welcome-start")).toContain("flex-wrap: wrap");
	expect(rule(".mete-welcome-start")).toContain("padding: 8px 12px");
	expect(rule(".mete-welcome-start > p")).toContain("min-width: 0");
	expect(rule(".mete-welcome-start > p")).toContain("overflow-wrap: anywhere");
});
