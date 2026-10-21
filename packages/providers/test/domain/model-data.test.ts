import { describe, expect, it } from "vitest";
import {
	chatModels,
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

	it("does not read inherited properties as rows", () => {
		expect(chatModels("p", ["constructor"], {})[0]?.contextWindow).toBe(0);
	});
});
