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

const browserGame = {
	apiVersion: "mete/v1",
	kind: "AdapterMapping",
	metadata: { id: "browser-game", version: "1.0.0" },
	type: "cli",
	implements: {
		"gameengine.build@1": {
			command: "npm",
			args: ["run", "build"],
			success: { exitCode: 0 },
			output: { log: "{{result.stdout}}" },
		},
	},
};

describe("cli mappings", () => {
	it("takes the browser game mapping of docs/10 with no args as an empty list", () => {
		const m = AdapterMappingSchema.parse(browserGame);
		const entry = browserGame.implements["gameengine.build@1"];
		expect(m.type === "cli" && m.implements["gameengine.build@1"]).toEqual(
			entry,
		);
		const bare = AdapterMappingSchema.parse({
			...browserGame,
			implements: { "gameengine.test@1": { ...entry, args: undefined } },
		});
		expect(
			bare.type === "cli" && bare.implements["gameengine.test@1"]?.args,
		).toEqual([]);
	});

	it("refuses an entry without success, with a bad expression or an unknown key", () => {
		const entry = browserGame.implements["gameengine.build@1"];
		const with_ = (e: unknown) => ({
			...browserGame,
			implements: { "gameengine.build@1": e },
		});
		for (const bad of [
			with_({ ...entry, success: undefined }),
			with_({ ...entry, args: ["{{config.buildMethod}}"] }),
			with_({ ...entry, action: "shell.exec" }),
			with_({ ...entry, command: "" }),
		])
			expect(AdapterMappingSchema.safeParse(bad).success).toBe(false);
	});
});

describe("mappable outputs", () => {
	it("maps the nine media, 3d and game engine capabilities onto their answers", () => {
		const file = { file: "game/assets/hero.png" };
		for (const ref of [
			"media.image.generate@1",
			"media.image.edit@1",
			"media.3d.fromText@1",
			"media.3d.fromImage@1",
			"3d.export@1",
		] as const) {
			expect(MAPPABLE_OUTPUTS[ref]?.safeParse(file).success).toBe(true);
			expect(MAPPABLE_OUTPUTS[ref]?.safeParse({ file: "" }).success).toBe(
				false,
			);
		}
		const cleanup = MAPPABLE_OUTPUTS["3d.cleanup@1"];
		expect(cleanup?.safeParse({ ...file, report: "" }).success).toBe(true);
		expect(cleanup?.safeParse(file).success).toBe(false);
		for (const ref of [
			"gameengine.build@1",
			"gameengine.test@1",
			"gameengine.importAsset@1",
		] as const) {
			expect(MAPPABLE_OUTPUTS[ref]?.safeParse({ log: "" }).success).toBe(true);
			expect(MAPPABLE_OUTPUTS[ref]?.safeParse({}).success).toBe(false);
		}
	});

	it("checks a mapped web.search@1 answer", () => {
		const schema = MAPPABLE_OUTPUTS["web.search@1"];
		const one = { title: "T", url: "https://example.com/", snippet: "s" };
		expect(schema?.safeParse({ results: [one] }).success).toBe(true);
		expect(
			schema?.safeParse({ results: [{ ...one, url: "file:///etc" }] }).success,
		).toBe(false);
	});
});
