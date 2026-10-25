import { describe, expect, it } from "vitest";
import {
	assetRows,
	mediaTypeOf,
	parseManifest,
	sizeText,
} from "../src/domain/assets.js";

// The Assets model (docs/13, Assets; ADR-114): the folder's files joined with the MCP client's
// manifest, newest first.

const line = (over: object = {}) =>
	JSON.stringify({
		path: ".mete/assets/a.png",
		mediaType: "image/png",
		bytes: 2048,
		sha256: "abc",
		server: "demo",
		tool: "render",
		at: "2026-10-25T10:00:00.000Z",
		...over,
	});

describe("the asset rows", () => {
	it("joins a file with its manifest line: type, origin and time", () => {
		const rows = assetRows(
			[{ name: "a.png", bytes: 2048, mtime: 1 }],
			parseManifest(line()),
		);
		expect(rows).toEqual([
			{
				path: ".mete/assets/a.png",
				name: "a.png",
				mediaType: "image/png",
				bytes: 2048,
				image: true,
				at: "2026-10-25T10:00:00.000Z",
				origin: { server: "demo", tool: "render" },
			},
		]);
	});

	it("falls back to the extension and the file's time without a manifest line", () => {
		const rows = assetRows(
			[{ name: "report.json", bytes: 100, mtime: Date.UTC(2026, 9, 25, 9) }],
			new Map(),
		);
		expect(rows[0]).toMatchObject({
			mediaType: "application/json",
			image: false,
			bytes: 100,
		});
		expect(rows[0]?.at).toBe("2026-10-25T09:00:00.000Z");
	});

	it("leaves the manifest itself out and sorts the rest newest first", () => {
		const manifest = parseManifest(
			[
				line({
					path: ".mete/assets/old.png",
					at: "2026-10-24T10:00:00.000Z",
				}),
				line({
					path: ".mete/assets/new.png",
					at: "2026-10-25T10:00:00.000Z",
				}),
			].join("\n"),
		);
		const rows = assetRows(
			[
				{ name: "manifest.jsonl", bytes: 10 },
				{ name: "old.png", bytes: 1 },
				{ name: "new.png", bytes: 1 },
			],
			manifest,
		);
		expect(rows.map((r) => r.name)).toEqual(["new.png", "old.png"]);
	});

	it("skips a torn manifest line instead of failing the read", () => {
		const manifest = parseManifest(
			`{"path": ".mete/assets/a.png", "mediaType"\n${line()}\nnot json\n`,
		);
		expect(manifest.get(".mete/assets/a.png")?.tool).toBe("render");
	});

	it("names the media type of the files METE writes", () => {
		expect(mediaTypeOf("x.PNG")).toBe("image/png");
		expect(mediaTypeOf("model.glb")).toBe("model/gltf-binary");
		expect(mediaTypeOf("README")).toBe("application/octet-stream");
	});

	it("writes sizes in bytes, kilobytes and megabytes", () => {
		expect([sizeText(999), sizeText(2048), sizeText(5 * 1024 * 1024)]).toEqual([
			"999 B",
			"2.0 KB",
			"5.0 MB",
		]);
	});
});
