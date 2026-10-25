import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { err, ok, type Result } from "@mete/contracts";
import { type BrowserOptions, LhrSchema } from "@mete/tools";
import { z } from "zod";
import { SCRIPTED_BROWSER_ENV } from "../defaults.js";
import type { AppOptions } from "./app.js";

// The browser answers of a scripted app (docs/15, LLM replay; ADR-117): METE_SCRIPTED_BROWSER names a
// JSON file of screenshot sizes and Lighthouse reports, one per browser.screenshot@2 or seo.audit@2
// call, the last repeating. Each call writes the file its runner would have written and the real tool
// reads it back, so no Chromium starts, nothing downloads and no page is opened. Unset in normal use.

const ScreenshotSchema = z.strictObject({
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});

const ScriptSchema = z.strictObject({
	/** The size of each screenshot, one per call; the last repeats. */
	screenshots: z.array(ScreenshotSchema).default([]),
	/** The Lighthouse report of each audit, one per call; the last repeats. */
	audits: z.array(LhrSchema).default([]),
});

/** What a scripted app answers its browser tools with. */
export type BrowserScript = z.output<typeof ScriptSchema>;

/** The script a path names; a bad file fails the app with its path, not with a stack of JSON. */
export const readBrowserScript = (file: string): BrowserScript => {
	try {
		return ScriptSchema.parse(JSON.parse(readFileSync(file, "utf8")));
	} catch (e) {
		throw new Error(
			`METE_SCRIPTED_BROWSER ${file}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The checksum each PNG chunk ends with, built once for the seam's images.
const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

const crc32 = (bytes: Buffer) => {
	let c = 0xffffffff;
	for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const size = Buffer.alloc(4);
	size.writeUInt32BE(data.length);
	const sum = Buffer.alloc(4);
	sum.writeUInt32BE(crc32(body));
	return Buffer.concat([size, body, sum]);
};

/** A black PNG of the scripted size, so the tool measures a real image and not a header stub. */
const pngOf = (width: number, height: number): Buffer => {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bits per channel
	header[9] = 0; // greyscale
	// A filter byte and one pixel per row; the zeros deflate to a few hundred bytes.
	const rows = Buffer.alloc((width + 1) * height);
	return Buffer.concat([
		SIGNATURE,
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	]);
};

const wrote = (out: string, bytes: Buffer | string): Result<void, string> => {
	try {
		writeFileSync(out, bytes);
		return ok(undefined);
	} catch (e) {
		return err(
			`writing ${out} failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
};

/**
 * The browser answers of a scripted app (ADR-117): an explicit value wins, then the environment
 * variable the desktop sets; unset, the browser tools start Chromium and open the page.
 */
export const browserOf = (
	env: { readonly scriptedBrowser?: string },
	read: (name: string) => string | undefined = (name) => process.env[name],
): Pick<AppOptions, "browser"> => {
	const file = env.scriptedBrowser ?? read(SCRIPTED_BROWSER_ENV);
	return file ? { browser: scriptedBrowser(file) } : {};
};

/**
 * The browser a scripted app gives its browser tools: the n-th call writes the n-th entry of the
 * script to the file the tool reads back, and Chromium counts as installed, so nothing installs.
 */
export const scriptedBrowser = (
	file: string,
): Pick<BrowserOptions, "run" | "chromium"> => {
	const script = readBrowserScript(file);
	let shots = 0;
	let audits = 0;
	const entry = <T>(
		list: readonly T[],
		index: number,
		what: string,
	): Result<T, string> => {
		const found = list[Math.min(index, list.length - 1)];
		return found === undefined
			? err(`METE_SCRIPTED_BROWSER ${file}: the script names no ${what}`)
			: ok(found);
	};
	return {
		run: async (req) => {
			if (req.kind === "screenshot") {
				const size = entry(script.screenshots, shots++, "screenshot");
				return size.ok
					? wrote(req.out, pngOf(size.value.width, size.value.height))
					: size;
			}
			const report = entry(script.audits, audits++, "audit");
			return report.ok ? wrote(req.out, JSON.stringify(report.value)) : report;
		},
		chromium: {
			installed: () => true,
			install: async () => ok(undefined),
		},
	};
};
