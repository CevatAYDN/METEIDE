import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScreenEmpty } from "../src/application/screen-empty.js";

// The empty state the main screens share, rendered to HTML on Node.

describe("a screen's empty state", () => {
	it("draws the glyph in a tile, the sentence, and no action slot without one", () => {
		const out = renderToStaticMarkup(
			createElement(ScreenEmpty, { icon: "diff", text: "No changes." }),
		);
		expect(out).toBe(
			'<div class="mete-screen-empty"><span class="mete-screen-empty-tile" aria-hidden="true"><span aria-hidden="true" class="codicon codicon-diff"></span></span><p>No changes.</p></div>',
		);
	});

	it("puts the one action under the sentence", () => {
		const out = renderToStaticMarkup(
			createElement(ScreenEmpty, {
				icon: "book",
				text: "No notes yet.",
				action: createElement("button", { type: "button" }, "New run"),
			}),
		);
		expect(out).toContain(
			'<p>No notes yet.</p><div class="mete-screen-empty-action"><button type="button">New run</button></div>',
		);
	});
});
