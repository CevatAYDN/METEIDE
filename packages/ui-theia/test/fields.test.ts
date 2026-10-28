import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Count } from "../src/application/fields.js";

// The team editor's number field must not share a class with the tab and title count chip
// (mete-run.css): every sheet is global, so the field's width once stretched the rail's chips.

describe("Count", () => {
	it("styles its input apart from the count chip", () => {
		const out = renderToStaticMarkup(
			createElement(Count, {
				label: "Revisions per task",
				value: 3,
				fallback: 3,
				onChange: () => {},
			}),
		);
		expect(out).toContain('class="mete-field mete-number"');
		expect(out).not.toMatch(/class="[^"]*\bmete-count(?![\w-])/);
	});
});
