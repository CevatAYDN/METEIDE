import {
	filterItems,
	type QuickPickItem,
	type QuickPicks,
} from "@theia/core/lib/common/quick-pick-service";
import { describe, expect, it, vi } from "vitest";
import { filterCommandPicks } from "../src/application/command-palette-filter.js";

const permissions = {
	id: "permissions",
	label: "METE: \u0130zinleri a\u00e7",
	detail: "METE: Open permissions",
};

function picked(items: QuickPicks, filter: string): QuickPickItem {
	const result = filterCommandPicks(items, filter);
	expect(result).toHaveLength(1);
	const item = result[0];
	if (!item || item.type === "separator") {
		throw new Error("Expected one command item");
	}
	return item;
}

describe("filterCommandPicks", () => {
	it("captures the installed native dotted-I failure including terminal ac", () => {
		expect(filterItems([{ ...permissions }], permissions.label)).toEqual([]);
		expect(filterItems([{ ...permissions }], "izinleri a\u00e7")).toEqual([]);
	});

	it.each([permissions.label, "izinleri a\u00e7"])(
		"matches the entire Turkish command with query %s",
		(query) => {
			const item = picked([{ ...permissions }], query);
			expect(item.label).toBe(permissions.label);
			expect(item.detail).toBe(permissions.detail);
			expect(item.highlights?.label?.at(-1)?.end).toBe(17);
			expect(item.highlights?.label?.[0]?.start).toBe(
				query === permissions.label ? 0 : 6,
			);
		},
	);

	it("maps substring highlights after dotted I to original UTF-16 offsets", () => {
		const item = picked([{ ...permissions }], "zinleri a\u00e7");
		expect(item.highlights?.label).toEqual([{ start: 7, end: 17 }]);
		expect(item.label.slice(7, 17)).toBe("zinleri a\u00e7");
	});

	it("maps contiguous full-query highlights without a trailing overflow", () => {
		const item = picked([{ ...permissions }], permissions.label);
		expect(item.highlights?.label).toEqual([{ start: 0, end: 17 }]);
	});

	it.each(["METE: Open permissions", "open permissions"])(
		"retains English detail alias matching for %s",
		(query) => {
			const item = picked([{ ...permissions }], query);
			expect(item.detail).toBe(permissions.detail);
			expect(item.highlights?.detail).toEqual([
				{ start: query.startsWith("METE") ? 0 : 6, end: 22 },
			]);
			expect(item.highlights?.label).toBeUndefined();
		},
	);

	it.each(["description", "detail"] as const)(
		"maps Turkish %s highlights and preserves displayed text",
		(field) => {
			const item = picked(
				[{ label: "Unrelated", [field]: permissions.label }],
				"zinleri a\u00e7",
			);
			expect(item[field]).toBe(permissions.label);
			expect(item.highlights?.[field]).toEqual([{ start: 7, end: 17 }]);
		},
	);

	it("keeps native ASCII rank, stable ties, fuzzy highlights and separator groups", () => {
		const items: QuickPicks = [
			{ type: "separator", label: "Recent" },
			{ id: "fuzzy", label: "filler orange orchard" },
			{ id: "substring", label: "Before foo" },
			{ id: "prefix", label: "Foo first" },
			{ id: "tie", label: "Foo second" },
			{ type: "separator", label: "Empty" },
			{ label: "Unrelated" },
			{ type: "separator", label: "Other" },
			{ id: "other", label: "Foo other" },
			{ type: "separator", label: "Trailing" },
		];
		const actual = filterCommandPicks(items, "FOO");
		expect(actual).toEqual(
			filterItems(
				items.map((item) => ({ ...item })),
				"FOO",
			),
		);
		expect(actual.map((item) => item.label)).toEqual([
			"Recent",
			"Foo first",
			"Foo second",
			"Before foo",
			"filler orange orchard",
			"Other",
			"Foo other",
		]);
	});

	it.each(["", " \t\n "])(
		"clears output highlights without changing frozen input for blank %j",
		(query) => {
			const highlights = Object.freeze({ label: [{ start: 0, end: 4 }] });
			const item = Object.freeze({ ...permissions, highlights });
			const separator = Object.freeze({
				type: "separator" as const,
				label: "Group",
			});
			const items: QuickPicks = [separator, item];
			Object.freeze(items);
			const output = filterCommandPicks(items, query);
			expect(output.map((entry) => entry.label)).toEqual([
				"Group",
				permissions.label,
			]);
			expect(output[0]).toBe(separator);
			expect(output[1]).not.toBe(item);
			expect(output[1]).not.toHaveProperty("highlights");
			expect(item.highlights).toBe(highlights);
		},
	);

	it("retains callbacks, ids, keybindings and metadata without mutating inputs", () => {
		const execute = vi.fn();
		const item = Object.freeze({
			...permissions,
			execute,
			keySequence: [],
			iconClasses: ["command-icon"],
			buttons: [{ tooltip: "Action" }],
			meta: "command metadata",
			ariaLabel: "Accessible command",
			alwaysShow: false,
			commandContext: { enabled: false },
			highlights: { label: [{ start: 0, end: 4 }] },
		});
		const items: QuickPicks = [item];
		Object.freeze(items);
		const output = picked(items, "izinleri a\u00e7");
		const { highlights: _old, ...original } = item;
		const { highlights: _new, ...restored } = output;
		expect(restored).toEqual(original);
		expect(output.execute).toBe(execute);
		expect(output.keySequence).toBe(item.keySequence);
		expect(output.buttons).toBe(item.buttons);
		output.execute?.();
		expect(execute).toHaveBeenCalledOnce();
		expect(item.highlights).toEqual({ label: [{ start: 0, end: 4 }] });
		expect(items).toEqual([item]);
	});

	it("returns no match even for alwaysShow items and drops empty groups", () => {
		expect(
			filterCommandPicks(
				[
					{ type: "separator", label: "Group" },
					{ ...permissions, alwaysShow: true },
				],
				"zzzz",
			),
		).toEqual([]);
		expect(filterCommandPicks([], "anything")).toEqual([]);
	});

	it("does not strip accents or equate dotless I with dotted I", () => {
		expect(filterCommandPicks([{ label: "a\u00e7" }], "ac")).toEqual([]);
		expect(filterCommandPicks([{ label: "\u0131" }], "i")).toEqual([]);
	});

	it("keeps surrogate pairs whole in fuzzy highlights after a case expansion", () => {
		const item = picked([{ label: "\u0130x\u{1f680}y" }], "i\u{1f680}");
		expect(item.highlights?.label).toEqual([
			{ start: 0, end: 1 },
			{ start: 2, end: 4 },
		]);
	});

	it("preserves whole-string contextual lowercase behavior", () => {
		expect(picked([{ label: "\u039f\u03a3" }], "\u03bf\u03c2").label).toBe(
			"\u039f\u03a3",
		);
	});
});
