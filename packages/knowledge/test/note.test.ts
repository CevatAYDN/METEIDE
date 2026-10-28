import { describe, expect, it } from "vitest";
import { notePath, slugOf } from "../src/domain/note.js";

// A note's file name and path (docs/11, Vaults; ADR-145).

describe("slugOf", () => {
	it("keeps letters and digits, lower case, without accents", () => {
		expect(slugOf("Write collision tests early")).toBe(
			"write-collision-tests-early",
		);
		expect(slugOf("  Çarpışma: İlk 3 test!  ")).toBe("carpısma-ilk-3-test");
		expect(slugOf("!!!")).toBe("");
	});

	it("cuts at 60 characters without a trailing dash", () => {
		const slug = slugOf(`${"a".repeat(59)} b`);
		expect(slug).toBe("a".repeat(59));
		expect(slugOf("x".repeat(80))).toHaveLength(60);
	});

	it("never names a file after a Windows device", () => {
		expect(slugOf("CON")).toBe("con-note");
		expect(slugOf("lpt1")).toBe("lpt1-note");
		expect(slugOf("console")).toBe("console");
	});
});

describe("notePath", () => {
	it("normalizes a note path inside the vault", () => {
		expect(notePath("lessons/./a.md")).toBe("lessons/a.md");
		expect(notePath("lessons\\a.md")).toBe("lessons/a.md");
		expect(notePath("lessons/../decisions/b.md")).toBe("decisions/b.md");
	});
});
