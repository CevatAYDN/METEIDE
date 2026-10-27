import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	type AssetItem,
	type AssetsModel,
	AssetsView,
} from "../src/application/assets-view.js";

// The Assets view (docs/13, Assets; ADR-114): a saved image as its picture, every row's type,
// origin and size, and Open for a file without a preview.

const item = (over: Partial<AssetItem> = {}): AssetItem => ({
	path: ".mete/assets/a.png",
	name: "a.png",
	mediaType: "image/png",
	bytes: 2048,
	image: true,
	at: "2026-10-25T10:00:00.000Z",
	origin: { server: "demo", tool: "render" },
	url: "file:///w/.mete/assets/a.png",
	...over,
});

const html = (model: AssetsModel) =>
	renderToStaticMarkup(
		createElement(AssetsView, {
			model,
			onOpen: () => {},
			onRefresh: () => {},
		}),
	);

describe("the Assets view", () => {
	it("draws an image as its picture, with its type, origin and size", () => {
		const out = html({ kind: "rows", rows: [item()] });
		expect(out).toContain(
			'<img class="mete-asset-thumb" src="file:///w/.mete/assets/a.png"',
		);
		expect(out).toContain("a.png");
		expect(out).toContain("image/png");
		// The server over the tool, with the dot between them kept for text.
		expect(out).toMatch(
			/>demo<\/span><span[^>]*> · <\/span><span[^>]*>render</,
		);
		expect(out).toContain("2.0 KB");
	});

	it("offers Open for a file that has no preview", () => {
		const out = html({
			kind: "rows",
			rows: [
				item({
					path: ".mete/assets/report.json",
					name: "report.json",
					mediaType: "application/json",
					image: false,
					url: "file:///w/.mete/assets/report.json",
				}),
			],
		});
		expect(out).toMatch(
			/aria-label="Open report\.json"[^>]*><span[^>]*><\/span>Open<\/button>/,
		);
	});

	it("says when there is nothing yet", () => {
		expect(html({ kind: "rows", rows: [] })).toContain("No assets yet");
	});
});
