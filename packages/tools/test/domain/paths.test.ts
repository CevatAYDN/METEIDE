import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { absolute, isInside, shown } from "../../src/domain/paths.js";

const root = resolve("ws");

describe("isInside", () => {
	it("admits the root and its children, never a sibling or parent", () => {
		expect(isInside(root, root)).toBe(true);
		expect(isInside(root, join(root, "a", "b"))).toBe(true);
		expect(isInside(root, join(root, "..ok"))).toBe(true);
		expect(isInside(root, resolve("ws-other"))).toBe(false);
		expect(isInside(root, resolve("."))).toBe(false);
	});
});

describe("absolute and shown", () => {
	it("resolves against the workspace and reports with forward slashes", () => {
		const p = absolute(root, "src/a.ts");
		expect(p).toBe(join(root, "src", "a.ts"));
		expect(shown(root, p)).toBe("src/a.ts");
		expect(shown(root, root)).toBe(".");
		expect(shown(root, resolve("elsewhere", "x"))).toBe(
			resolve("elsewhere", "x").split("\\").join("/"),
		);
	});
});
