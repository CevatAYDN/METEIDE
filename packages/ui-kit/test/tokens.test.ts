import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKEN_NAMES, TOKENS, tokenProperties } from "../src/domain/tokens.js";

// The tokens stay in step with docs/13's table: a changed colour there fails here until the code follows.

const DOC = readFileSync(
	new URL("../../../docs/13-ui-and-studio-view.md", import.meta.url),
	"utf8",
);
const ROW = /^\| `--([a-z]+)` \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \|$/gm;

describe("the design tokens", () => {
	it("hold exactly the light and dark colours of docs/13", () => {
		const rows = [...DOC.matchAll(ROW)].map((m) => [m[1], m[2], m[3]]);
		expect(rows.map((r) => r[0])).toEqual([...TOKEN_NAMES]);
		for (const [name, light, dark] of rows) {
			const token = name as (typeof TOKEN_NAMES)[number];
			expect(TOKENS.light[token]).toBe(light);
			expect(TOKENS.dark[token]).toBe(dark);
		}
	});

	it("give a panel its CSS custom properties for one theme", () => {
		const dark = tokenProperties("dark");
		expect(Object.keys(dark)).toEqual(TOKEN_NAMES.map((n) => `--${n}`));
		expect(dark["--accent"]).toBe("#8F83F2");
		expect(tokenProperties("light")["--bg"]).toBe("#ECEAF4");
	});
});
