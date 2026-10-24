import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHAPE, TOKEN_NAMES } from "@mete/ui-kit";
import { describe, expect, it } from "vitest";
import * as look from "../src/application/look.js";
import { TONES } from "../src/application/tone.js";

// The design system of docs/13 as the panels use it (ADR-069): every colour names a METE token with
// a Theia colour as its fallback, so a high-contrast theme keeps Theia's look; the stylesheet carries
// Baloo 2, bundled, and the shape.

const CSS = readFileSync(join(__dirname, "..", "style", "mete.css"), "utf8");

// Every var(--x ...) in a text, with what follows the name up to its closing parenthesis.
const vars = (text: string) =>
	[...text.matchAll(/var\(--([a-z-]+)(,[^()]*(\([^()]*\))?[^()]*)?\)/g)].map(
		(m) => ({ name: m[1] ?? "", fallback: m[2] ?? "" }),
	);

describe("the panels' look", () => {
	it("gives every METE token a Theia fallback, in the shared styles and the stylesheet", () => {
		const styles = JSON.stringify([
			...Object.values(look),
			...Object.values(TONES),
		]);
		const tokens = new Set<string>(TOKEN_NAMES);
		const used = [...vars(styles), ...vars(CSS)].filter((v) =>
			tokens.has(v.name),
		);
		expect(used.length).toBeGreaterThan(0);
		for (const v of used) expect(v.fallback).toContain("var(--theia-");
	});

	it("colours every chip tone the status map uses", () => {
		for (const tone of ["accent", "warn", "good", "bad", "muted"])
			expect(CSS).toContain(`.mete-chip.${tone}`);
	});

	it("leaves no Theia colour in a view except as a METE token's fallback", () => {
		const dirs = [
			join(__dirname, "..", "src", "application"),
			join(__dirname, "..", "src", "infrastructure"),
		];
		const views = dirs.flatMap((dir) =>
			readdirSync(dir)
				.filter((f) => f.endsWith("-view.tsx"))
				.map((f) => join(dir, f)),
		);
		expect(views.length).toBeGreaterThan(4);
		const tokens = TOKEN_NAMES.join("|");
		const fallback = new RegExp(
			`var\\(--(${tokens}), var\\(--theia-[a-zA-Z-]+\\)\\)`,
			"g",
		);
		for (const file of views) {
			const bare = readFileSync(file, "utf8")
				.replace(fallback, "")
				.match(/var\(--theia-[a-zA-Z-]+\)/g);
			expect({ file, bare }).toEqual({ file, bare: null });
		}
	});

	it("bundles Baloo 2 at the docs/13 weights and uses the docs/13 shape", () => {
		expect(CSS).toContain('font-family: "Baloo 2"');
		expect(CSS).toContain("font-weight: 500");
		expect(CSS).toContain("url(../fonts/Baloo2-latin.woff)");
		expect(CSS).not.toMatch(/url\(["']?https?:/);
		for (const value of Object.values(SHAPE)) expect(CSS).toContain(value);
	});
});
