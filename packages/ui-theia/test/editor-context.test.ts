import URI from "@theia/core/lib/common/uri";
import { expect, it, vi } from "vitest";
import { captureEditorContext } from "../src/application/editor-context.js";

const range = {
	start: { line: 0, character: 1 },
	end: { line: 0, character: 3 },
};
const editor = () => ({
	uri: URI.fromFilePath("/w/a.ts"),
	selection: { ...range, direction: "rtl" as const },
	document: {
		dirty: true,
		getText: vi.fn((selected?: typeof range) =>
			selected ? "\uD83D\uDE00" : "a\uD83D\uDE00b",
		),
		toValidRange: (selected: typeof range) => selected,
	},
});

it("captures current dirty text with zero-based UTF16 exclusive range and no direction field", () => {
	const source = editor();
	expect(captureEditorContext(source, "selection")).toEqual({
		ok: true,
		value: {
			path: source.uri.path.fsPath(),
			content: "\uD83D\uDE00",
			modified: true,
			range,
		},
	});
	expect(source.document.getText).toHaveBeenCalledWith(range);
	expect(captureEditorContext(source, "file")).toEqual({
		ok: true,
		value: {
			path: source.uri.path.fsPath(),
			content: "a\uD83D\uDE00b",
			modified: true,
		},
	});
});

it("refuses empty, remote and unavailable editors without reading another source", () => {
	expect(captureEditorContext(undefined, "file").ok).toBe(false);
	const source = editor();
	source.uri = new URI("untitled:a.ts");
	expect(captureEditorContext(source, "file").ok).toBe(false);
	expect(source.document.getText).not.toHaveBeenCalled();
	source.uri = URI.fromFilePath("/w/a.ts");
	source.selection = { ...source.selection, end: range.start };
	expect(captureEditorContext(source, "selection").ok).toBe(false);
});

it("updates the same stored range and refuses a range no longer in the document", () => {
	const source = editor();
	source.selection = { ...source.selection, start: { line: 9, character: 0 } };
	expect(captureEditorContext(source, "file", range)).toMatchObject({
		ok: true,
		value: { range, content: "\uD83D\uDE00" },
	});
	source.document.toValidRange = () => ({
		start: range.start,
		end: range.start,
	});
	expect(captureEditorContext(source, "file", range).ok).toBe(false);
});
