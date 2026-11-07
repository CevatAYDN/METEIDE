import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("bounds the aggregate preview list so four expanded files cannot push Send out of the composer", () => {
	const css = readFileSync(
		join(__dirname, "..", "style", "mete-context.css"),
		"utf8",
	);
	const start = css.indexOf(".mete-context-draft ul {");
	expect(start).toBeGreaterThanOrEqual(0);
	const list = css.slice(start, css.indexOf("}", start));
	expect(list).toContain("max-height: min(240px, 25vh)");
	expect(list).toContain("overflow: auto");
	expect(list).toContain("overscroll-behavior: contain");
});
