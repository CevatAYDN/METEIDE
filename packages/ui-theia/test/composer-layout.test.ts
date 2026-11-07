import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(
	join(__dirname, "..", "style", "mete-composer.css"),
	"utf8",
);
const rule = (selector: string) => {
	const start = css.indexOf(`${selector} {`);
	expect(start).toBeGreaterThanOrEqual(0);
	return css.slice(start, css.indexOf("}", start));
};

it("bounds goal growth without a fixed-width aside or clipping model popups", () => {
	const root = rule(".mete-composer");
	expect(root).toContain("max-width: 1040px");
	expect(root).toContain("min-width: 0");
	const goal = rule(".mete-composer .mete-composer-field > textarea");
	expect(goal).toContain("max-height: 120px");
	expect(goal).toContain("width: 100%");
	expect(goal).toContain("resize: none");
	expect(rule(".mete-composer .mete-composer-side")).not.toContain("380px");
	for (const selector of [
		".mete-composer",
		".mete-composer .mete-composer-goal",
		".mete-composer .mete-composer-controls",
		".mete-composer .mete-composer-prefer",
	])
		expect(rule(selector)).not.toContain("overflow: hidden");
});

it("keeps action geometry stable while model and tool controls wrap", () => {
	expect(rule(".mete-composer .mete-composer-controls")).toContain(
		"flex-wrap: wrap",
	);
	const start = rule(".mete-composer .mete-composer-start");
	expect(start).toContain("width: 28px");
	expect(start).toContain("height: 28px");
	expect(start).toContain("flex: none");
	expect(rule(".mete-composer .mete-composer-model")).toContain("min-width: 0");
});
