import { describe, expect, it } from "vitest";
import { artifactSchema } from "../../src/domain/artifacts.js";
import {
	VaultReadInputSchema,
	VaultWriteInputSchema,
} from "../../src/domain/vault.js";

// vault.read@1, vault.write@1 and lesson@1 (docs/11, Vaults; ADR-145).

describe("vault tool inputs", () => {
	it("reads a note of the workspace vault unless the personal one is named", () => {
		expect(VaultReadInputSchema.parse({ path: "lessons/a.md" })).toEqual({
			path: "lessons/a.md",
			scope: "workspace",
		});
		expect(
			VaultReadInputSchema.parse({ path: "a.md", scope: "personal" }).scope,
		).toBe("personal");
		expect(VaultReadInputSchema.safeParse({ path: "" }).success).toBe(false);
	});

	it("writes only the note types agents may write", () => {
		const note = { title: "Write collision tests early", body: "Why." };
		for (const type of ["lesson", "entity", "decision", "journal"])
			expect(VaultWriteInputSchema.parse({ type, ...note })).toEqual({
				type,
				...note,
				tags: [],
				scope: "workspace",
			});
		expect(
			VaultWriteInputSchema.safeParse({ type: "inbox", ...note }).success,
		).toBe(false);
		expect(
			VaultWriteInputSchema.safeParse({ type: "lesson", ...note, extra: 1 })
				.success,
		).toBe(false);
	});
});

describe("lesson@1", () => {
	const schema = artifactSchema("lesson@1");
	const lesson = {
		title: "Write collision tests early",
		lesson: "Write the collision test before the movement code.",
		evidence: "The tester returned the build twice for ships passing walls.",
	};

	it("is a title, a lesson, its evidence and tags", () => {
		expect(schema?.parse(lesson)).toEqual({ ...lesson, tags: [] });
		expect(schema?.parse({ ...lesson, tags: ["testing"] })).toMatchObject({
			tags: ["testing"],
		});
	});

	it("rejects a missing field and an unknown key", () => {
		expect(schema?.safeParse({ ...lesson, evidence: "" }).success).toBe(false);
		expect(schema?.safeParse({ ...lesson, worked: true }).success).toBe(false);
	});
});
