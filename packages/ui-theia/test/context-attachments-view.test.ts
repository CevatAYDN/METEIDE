import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ContextAttachments } from "../src/application/context-attachments-view.js";

it("shows the exact masked preview, source range, unsaved state and accessible explicit actions", () => {
	const markup = renderToStaticMarkup(
		createElement(ContextAttachments, {
			items: [
				{
					id: "one",
					sourcePath: "/w/a.ts",
					snapshot: {
						path: "a.ts",
						content: "<masked>",
						modified: true,
						sha256: "a".repeat(64),
						range: {
							start: { line: 0, character: 2 },
							end: { line: 1, character: 3 },
						},
					},
				},
			],
			busy: false,
			onAdd: () => {},
			onRemove: () => {},
			onUpdate: () => {},
		}),
	);
	expect(markup).toContain("&lt;masked&gt;");
	expect(markup).toContain("a.ts");
	expect(markup).toContain("1:3");
	expect(markup).toContain("2:4");
	expect(markup).toContain("Unsaved");
	for (const label of [
		"Add selection",
		"Add open file",
		"Remove attachment",
		"Update attachment",
	])
		expect(markup).toContain(label);
	expect(markup).toContain("codicon");
	expect(markup).toContain(
		'<pre role="document" tabindex="0" aria-label="a.ts">',
	);
});

it("freezes all edit actions during preparation or sending and reports failure explicitly", () => {
	const markup = renderToStaticMarkup(
		createElement(ContextAttachments, {
			items: [],
			busy: true,
			error: "Preview unavailable; previous attachments are kept.",
			onAdd: () => {},
			onRemove: () => {},
			onUpdate: () => {},
		}),
	);
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("disabled");
	expect(markup).toContain("Attachment controls are busy.");
});

it("disables historical edit actions without claiming a pending attachment operation", () => {
	const markup = renderToStaticMarkup(
		createElement(ContextAttachments, {
			items: [
				{
					id: "one",
					sourcePath: "/w/a.ts",
					snapshot: {
						path: "a.ts",
						content: "fixed",
						modified: false,
						sha256: "a".repeat(64),
					},
				},
			],
			busy: false,
			disabled: true,
			onAdd: () => {},
			onRemove: () => {},
			onUpdate: () => {},
		}),
	);
	expect(markup.match(/disabled=""/g)).toHaveLength(4);
	expect(markup).not.toContain("Attachment controls are busy.");
	expect(markup).not.toContain('role="status"');
	expect(markup).toContain(
		'<pre role="document" tabindex="0" aria-label="a.ts">',
	);
});
