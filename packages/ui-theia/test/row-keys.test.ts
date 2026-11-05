import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	rowKeys,
	uniqueKeys,
	useRowKeys,
	withRowKeys,
} from "../src/application/row-keys.js";

// Stable keys for editable lists whose rows have no id of their own: a grown list appends keys,
// a removal keeps the other rows' keys, and a re-render of the same list changes nothing.

describe("rowKeys", () => {
	it("appends keys when the list grows and keeps the old ones", () => {
		const store = rowKeys();
		const two = [...store.fit(2)];
		expect(two).toHaveLength(2);
		expect(new Set(two).size).toBe(2);
		const three = store.fit(3);
		expect(three.slice(0, 2)).toEqual(two);
		expect(three).toHaveLength(3);
	});

	it("keeps the surviving rows' keys after a removal", () => {
		const store = rowKeys();
		const [a, _b, c] = store.fit(3);
		store.remove(1);
		expect(store.fit(2)).toEqual([a, c]);
	});

	it("is stable across renders of the same list", () => {
		const store = rowKeys();
		const first = [...store.fit(2)];
		expect(store.fit(2)).toEqual(first);
		expect(store.keys).toEqual(first);
	});

	it("drops the last keys when the list shrinks without a reported removal", () => {
		const store = rowKeys();
		const [a] = store.fit(3);
		expect(store.fit(1)).toEqual([a]);
	});

	it("never repeats a key across stores", () => {
		const a = rowKeys().fit(2);
		const b = rowKeys().fit(2);
		expect(a.some((k) => b.includes(k))).toBe(false);
	});
});

describe("uniqueKeys", () => {
	it("keys rows by their name and counts a repeat", () => {
		expect(uniqueKeys(["dev", "qa", "dev", "dev"])).toEqual([
			"dev",
			"qa",
			"dev#1",
			"dev#2",
		]);
	});
});

describe("withRowKeys", () => {
	it("tells the keys about a removal before the card's own action", () => {
		const store = rowKeys();
		const [a, _b, c] = store.fit(3);
		const removed: number[] = [];
		const acts = withRowKeys(
			{ onAdd: () => {}, onRemove: (i: number) => removed.push(i) },
			store,
		);
		acts.onRemove(1);
		expect(removed).toEqual([1]);
		expect(store.fit(2)).toEqual([a, c]);
	});
});

describe("useRowKeys", () => {
	it("gives a component one distinct key per row", () => {
		const List = ({ n }: { readonly n: number }) => {
			const rows = useRowKeys(n);
			return createElement("ul", null, [
				...rows.keys.map((k) => createElement("li", { key: k }, k)),
			]);
		};
		const out = renderToStaticMarkup(createElement(List, { n: 3 }));
		expect(out.match(/<li>/g)).toHaveLength(3);
		expect(new Set(out.match(/row-\d+/g)).size).toBe(3);
	});
});
