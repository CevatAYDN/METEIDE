import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The resource files stay in step with the code (docs/13: every UI string lives in resource files):
// each key the sources localize is in the English and the Turkish file, and each placeholder of an
// English text is in its Turkish one. i18n/nls.json comes from `theia nls-extract`.

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

const sources = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});

// nls.localize("key", "English text", ...) and
// Command.toLocalizedCommand({ id, category: "METE", label: "Status" }, "label key", "category key"),
// also wrapped over lines, where the formatter ends the label with a comma.
const LOCALIZE = /nls\.localize\(\s*"([^"]+)",\s*"([^"]*)"/g;
const COMMAND =
	/toLocalizedCommand\(\s*\{[^}]*?category:\s*"([^"]+)",\s*label:\s*"([^"]+)",?\s*\},\s*"([^"]+)",\s*"([^"]+)"/g;

// Each key with the English text the code gives it.
const pairsOf = (text: string): [string, string][] =>
	[
		...[...text.matchAll(LOCALIZE)].map((m) => [m[1], m[2]]),
		...[...text.matchAll(COMMAND)].flatMap((m) => [
			[m[3], m[2]],
			[m[4], m[1]],
		]),
	].filter(
		(p): p is [string, string] => p[0] !== undefined && p[1] !== undefined,
	);

const textsInCode = () =>
	new Map(sources(SRC).flatMap((file) => pairsOf(readFileSync(file, "utf8"))));

// The nested JSON Theia flattens with "/" (LocalizationRegistry.flattenTranslations).
const flatten = (value: unknown, prefix = ""): [string, string][] =>
	typeof value === "object" && value !== null
		? Object.entries(value).flatMap(([key, inner]) => {
				const name = prefix ? `${prefix}/${key}` : key;
				return typeof inner === "string"
					? [[name, inner] as [string, string]]
					: flatten(inner, name);
			})
		: [];

const load = (file: string) =>
	new Map(flatten(JSON.parse(readFileSync(join(ROOT, "i18n", file), "utf8"))));

const placeholders = (text: string) =>
	[...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();

describe("the resource files", () => {
	const english = load("nls.json");
	const turkish = load("nls.tr.json");

	it("hold every key the code localizes, and no other", () => {
		const code = [...textsInCode().keys()].sort();
		expect(code.length).toBeGreaterThan(40);
		expect([...english.keys()].sort()).toEqual(code);
		expect([...turkish.keys()].sort()).toEqual(code);
	});

	it("keep the English text the code gives each key, so a changed default is extracted again", () => {
		for (const [key, text] of textsInCode())
			expect(english.get(key), key).toBe(text);
	});

	it("keep each placeholder of the English text in the Turkish one", () => {
		for (const [key, text] of english)
			expect(placeholders(turkish.get(key) ?? ""), key).toEqual(
				placeholders(text),
			);
	});
});
