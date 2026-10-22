import { describe, expect, it } from "vitest";
import {
	AdapterMappingSchema,
	MAPPABLE_OUTPUTS,
	templateParts,
} from "../../src/domain/mapping.js";

const exa = {
	apiVersion: "mete/v1",
	kind: "AdapterMapping",
	metadata: { id: "exa-mcp", version: "1.0.0" },
	type: "mcp",
	server: "exa",
	implements: {
		"web.search@1": {
			tool: "web_search_advanced_exa",
			action: "net.fetch",
			args: { query: "{{input.query}}", numResults: "{{input.maxResults}}" },
			output: {
				results: {
					each: "{{result.results}}",
					as: {
						title: "{{item.title}}",
						url: "{{item.url}}",
						snippet: "{{item.highlights | join(' ')}}",
					},
				},
			},
		},
	},
};

describe("adapter mapping files", () => {
	it("takes an mcp mapping and fills its defaults", () => {
		const m = AdapterMappingSchema.parse(exa);
		expect(m.type === "mcp" && m.implements["web.search@1"]?.features).toEqual(
			[],
		);
		const bare = { ...exa.implements["web.search@1"], action: undefined };
		const d = AdapterMappingSchema.parse({
			...exa,
			implements: { "a.b@1": bare },
		});
		expect(d.type === "mcp" && d.implements["a.b@1"]?.action).toBe("mcp.call");
	});

	it("refuses bad expressions, a broken each and a key that is no capability", () => {
		const entry = exa.implements["web.search@1"];
		const withOutput = (output: unknown) => ({
			...exa,
			implements: { "web.search@1": { ...entry, output } },
		});
		for (const bad of [
			withOutput("{{input.q | upper}}"),
			withOutput("{{env.HOME}}"),
			withOutput({ each: "{{result.a}}{{result.b}}", as: "x" }),
			withOutput({ each: "{{result.a}}" }),
			{ ...exa, implements: { search: entry } },
		])
			expect(AdapterMappingSchema.safeParse(bad).success).toBe(false);
	});
});

describe("template strings", () => {
	it("splits text and expressions with their filters", () => {
		expect(
			templateParts("ops:#({{input.ops | join(',')}}) {{result | json}}"),
		).toEqual({
			ok: true,
			value: [
				{ text: "ops:#(" },
				{ path: ["input", "ops"], filters: [{ name: "join", separator: "," }] },
				{ text: ") " },
				{ path: ["result"], filters: [{ name: "json" }] },
			],
		});
	});
});

describe("mappable outputs", () => {
	it("checks a mapped web.search@1 answer", () => {
		const schema = MAPPABLE_OUTPUTS["web.search@1"];
		const one = { title: "T", url: "https://example.com/", snippet: "s" };
		expect(schema?.safeParse({ results: [one] }).success).toBe(true);
		expect(
			schema?.safeParse({ results: [{ ...one, url: "file:///etc" }] }).success,
		).toBe(false);
	});
});
