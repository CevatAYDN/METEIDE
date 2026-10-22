import { describe, expect, it } from "vitest";
import { render, resultScope } from "../../src/domain/render.js";

const scope = {
	input: { query: "q", maxResults: 3, tags: ["a", "b"] },
	result: { results: [{ t: "x", h: ["1", "2"] }, { t: "y" }] },
};

describe("render", () => {
	it("keeps the type of a lone expression and joins text", () => {
		expect(
			render({ n: "{{input.maxResults}}", s: "n={{input.maxResults}}" }, scope),
		).toEqual({
			ok: true,
			value: { n: 3, s: "n=3" },
		});
		expect(
			render(["{{input.tags | join('+')}}", "{{input.tags | json}}"], scope),
		).toEqual({
			ok: true,
			value: ["a+b", '["a","b"]'],
		});
	});

	it("maps a list item by item; a missing value is empty in text", () => {
		const each = {
			each: "{{result.results}}",
			as: { t: "{{item.t}}", h: "{{item.h | join(' ')}}" },
		};
		expect(render(each, scope)).toEqual({
			ok: true,
			value: [
				{ t: "x", h: "1 2" },
				{ t: "y", h: "" },
			],
		});
		expect(render({ each: "{{input.query}}", as: "x" }, scope)).toEqual({
			ok: false,
			error: "{{input.query}} is not a list",
		});
	});
});

describe("resultScope", () => {
	it("prefers structured content, then JSON text, and always keeps the text", () => {
		expect(resultScope({ a: 1 }, ["t"])).toEqual({ a: 1, text: "t" });
		expect(resultScope(undefined, ['{"b":2}'])).toEqual({
			b: 2,
			text: '{"b":2}',
		});
		expect(resultScope(undefined, ["plain"])).toEqual({ text: "plain" });
	});
});
