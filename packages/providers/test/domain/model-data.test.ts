import { describe, expect, it } from "vitest";
import {
	chatModels,
	embedModels,
	type ModelRow,
	mergeModelData,
} from "../../src/domain/model-data.js";

const row = (over: Partial<ModelRow> = {}): ModelRow => ({
	capability: "chat",
	contextWindow: 200_000,
	toolCalling: true,
	vision: false,
	free: true,
	family: "glm",
	...over,
});

describe("mergeModelData", () => {
	it("replaces a shipped row with the user's row of the same id and adds others", () => {
		const merged = mergeModelData(
			{ nvidia: { a: row(), b: row({ family: "kimi" }) } },
			{
				nvidia: { a: row({ contextWindow: 8_000 }), c: row() },
				x: { d: row() },
			},
		);
		expect(merged).toEqual({
			nvidia: {
				a: row({ contextWindow: 8_000 }),
				b: row({ family: "kimi" }),
				c: row(),
			},
			x: { d: row() },
		});
	});
});

describe("chatModels", () => {
	it("fills facts from rows, fails closed without one and drops unlisted rows", () => {
		const rows = {
			known: row(),
			embedder: row({ capability: "embed" }),
			gone: row(),
		};
		expect(
			chatModels("nvidia", ["known", "embedder", "stranger"], rows),
		).toEqual([
			{
				id: "known",
				providerId: "nvidia",
				family: "glm",
				contextWindow: 200_000,
				toolCalling: true,
				vision: false,
				free: true,
				deprecated: false,
			},
			{
				id: "stranger",
				providerId: "nvidia",
				family: "",
				contextWindow: 0,
				toolCalling: "unknown",
				vision: "unknown",
				free: false,
				deprecated: false,
			},
		]);
	});

	it("gives a priced row its price (ADR-042)", () => {
		const rows = {
			paid: row({ free: false, price: { input: 0.2, output: 0.8 } }),
		};
		expect(chatModels("custom:x", ["paid"], rows)[0]?.price).toEqual({
			input: 0.2,
			output: 0.8,
		});
	});

	it("does not read inherited properties as rows", () => {
		expect(chatModels("p", ["constructor"], {})[0]?.contextWindow).toBe(0);
	});
});

describe("embedModels", () => {
	it("answers the listed ids of embed rows only (ADR-152)", () => {
		const rows = {
			embedder: row({ capability: "embed", contextWindow: 32_768 }),
			gone: row({ capability: "embed" }),
			chatter: row(),
			ranker: row({ capability: "rerank" }),
		};
		expect(
			embedModels(
				"nvidia",
				["embedder", "chatter", "ranker", "stranger", "constructor"],
				rows,
			),
		).toEqual([
			{
				id: "embedder",
				providerId: "nvidia",
				family: "glm",
				contextWindow: 32_768,
				toolCalling: true,
				vision: false,
				free: true,
				deprecated: false,
			},
		]);
	});
});
