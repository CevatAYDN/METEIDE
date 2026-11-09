import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
	SkillMetadataSchema,
	SkillSourceSnapshotSchema,
} from "../../src/index.js";

const metadata = { name: "review", description: "Review code" };
const fields = ["description", "license", "compatibility", "allowed-tools"];

describe("decoded skill metadata text", () => {
	it("retains full schema input and output string-map typing", () => {
		expectTypeOf<z.input<typeof SkillMetadataSchema>>().toEqualTypeOf<
			z.output<typeof SkillMetadataSchema>
		>();
		expectTypeOf<
			z.output<typeof SkillMetadataSchema>["metadata"]
		>().toEqualTypeOf<Record<string, string> | undefined>();
	});

	it("rejects NUL and either unpaired surrogate in every string boundary", () => {
		for (const text of ["a\0b", "\ud800", "\udc00"]) {
			const inputs = [
				...fields.map((field) => ({ ...metadata, [field]: text })),
				{ ...metadata, metadata: { [text]: "value" } },
				{ ...metadata, metadata: { key: text } },
			];
			for (const input of inputs)
				expect(SkillMetadataSchema.safeParse(input).success).toBe(false);
		}
	});

	it("retains human Unicode without stripping whitespace or repairing text", () => {
		const text = " \u00c7al\u0131\u015fma \u65e5\u672c \ud83d\udcdd ";
		const input = {
			name: "review",
			...Object.fromEntries(fields.map((field) => [field, text])),
			metadata: { [text]: text },
		};
		expect(SkillMetadataSchema.parse(input)).toEqual(input);
	});

	it("preserves own prototype-looking and numeric keys without mutating frozen input", () => {
		const pairs = Object.freeze(
			Object.fromEntries([
				["__proto__", "ordinary value"],
				["constructor", "ordinary constructor"],
				["prototype", "ordinary prototype"],
				["2", "two"],
				["10", "ten"],
			]),
		);
		const input = Object.freeze({ ...metadata, metadata: pairs });
		const before = Object.getOwnPropertyDescriptors(pairs);
		const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
		const parsed = SkillMetadataSchema.parse(input);
		expect(parsed.metadata).toEqual(pairs);
		expect(Object.entries(parsed.metadata ?? {})).toEqual(
			Object.entries(pairs),
		);
		expect(Object.hasOwn(parsed.metadata ?? {}, "__proto__")).toBe(true);
		expect(Object.getPrototypeOf(parsed.metadata)).toBe(Object.prototype);
		expect(Object.getOwnPropertyDescriptors(pairs)).toEqual(before);
		expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
			prototypeBefore,
		);
	});

	it("validates the value of an own __proto__ key rather than silently dropping it", () => {
		for (const value of [
			undefined,
			null,
			1,
			true,
			{},
			[],
			"x".repeat(1025),
			"a\0b",
			"\ud800",
			"\udc00",
		]) {
			const pairs = Object.fromEntries([["__proto__", value]]);
			expect(
				SkillMetadataSchema.safeParse({ ...metadata, metadata: pairs }).success,
			).toBe(false);
		}
	});

	it("preserves empty, exact-bound and Unicode values in an own __proto__ key", () => {
		for (const value of ["", "x".repeat(1024), "\ufeff\u00e9\r\n"]) {
			const pairs = Object.fromEntries([["__proto__", value]]);
			const parsed = SkillMetadataSchema.parse({
				...metadata,
				metadata: pairs,
			});
			expect(Object.entries(parsed.metadata ?? {})).toEqual([
				["__proto__", value],
			]);
		}
	});

	it("includes __proto__ in the documented 32-pair limit", () => {
		for (const count of [31, 32, 33]) {
			const pairs = Object.fromEntries([
				["__proto__", "ordinary value"],
				...Array.from({ length: count - 1 }, (_, n) => [`key-${n}`, "value"]),
			]);
			const parsed = SkillMetadataSchema.safeParse({
				...metadata,
				metadata: pairs,
			});
			expect(parsed.success).toBe(count <= 32);
			if (parsed.success)
				expect(Object.keys(parsed.data.metadata ?? {})).toHaveLength(count);
		}
	});

	it("retains pair-count and oversized-value issue classifications", () => {
		for (const firstKey of ["key-0", "__proto__"]) {
			const pairs = Object.fromEntries(
				Array.from({ length: 33 }, (_, n) => [
					n === 0 ? firstKey : `key-${n}`,
					"value",
				]),
			);
			const parsed = SkillMetadataSchema.safeParse({
				...metadata,
				metadata: pairs,
			});
			expect(parsed.success).toBe(false);
			if (!parsed.success) {
				expect(parsed.error.issues[0]?.code).toBe("custom");
				expect(parsed.error.issues[0]?.path[0]).toBe("metadata");
			}
		}
		for (const key of ["key", "__proto__"]) {
			const pairs = Object.fromEntries([[key, "x".repeat(1025)]]);
			const parsed = SkillMetadataSchema.safeParse({
				...metadata,
				metadata: pairs,
			});
			expect(parsed.success).toBe(false);
			if (!parsed.success) {
				expect(parsed.error.issues[0]?.code).toBe("too_big");
				expect(parsed.error.issues[0]?.path[0]).toBe("metadata");
			}
		}
	});

	it("keeps rejecting unsupported map shapes, symbol keys and unknown standard fields", () => {
		for (const pairs of [
			new Date(0),
			new Map([["key", "value"]]),
			[["key", "value"]],
			{ [Symbol("key")]: "value" },
		]) {
			expect(
				SkillMetadataSchema.safeParse({ ...metadata, metadata: pairs }).success,
			).toBe(false);
		}
		expect(
			SkillMetadataSchema.safeParse({ ...metadata, unknown: "value" }).success,
		).toBe(false);
		const pairs: Record<string, string> = Object.create(null);
		pairs.key = "value";
		expect(
			SkillMetadataSchema.parse({ ...metadata, metadata: pairs }).metadata,
		).toEqual({ key: "value" });
	});

	it("still preserves the raw source BOM and newline content", () => {
		const snapshot = {
			source: {
				sourceId: "a".repeat(64),
				scope: "workspace",
				path: "review/SKILL.md",
			},
			text: "\ufeff---\r\nname: review\r\n---\r\nBody",
			sha256: "b".repeat(64),
		};
		expect(SkillSourceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
	});
});
