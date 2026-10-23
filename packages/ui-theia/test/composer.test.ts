import { describe, expect, it } from "vitest";
import {
	type EstimateReply,
	narrowedTo,
	optionsOf,
	startOf,
} from "../src/application/composer.js";

// The composer's list and the request Start sends, without Theia (ADR-058, ADR-068, ADR-071).

const TEMPLATES = [
	{
		id: "game-studio",
		name: "Game studio",
		description: "Idea to playable prototype",
	},
	{ id: "web-dev", name: "Web development" },
];
const GROQ: EstimateReply = {
	ok: true,
	value: { providers: [{ providerId: "groq", requests: 15 }], unassigned: 0 },
};
const FAILED: EstimateReply = {
	ok: false,
	error: { code: "stopped", detail: "x" },
};

describe("optionsOf", () => {
	it("lists the router's choice, each template with its description, then a single agent", () => {
		const options = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);
		expect(options.map((o) => [o.key, o.label, o.description])).toEqual([
			["choose", "Let METE choose", undefined],
			["game-studio", "Game studio", "Idea to playable prototype"],
			["web-dev", "Web development", undefined],
			["single", "Single agent", undefined],
		]);
		expect(options.map((o) => o.templateId)).toEqual([
			undefined,
			"game-studio",
			"web-dev",
			null,
		]);
	});

	it("gives each team and the single agent its estimate line, and none to the router's choice", () => {
		const options = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);
		expect(options.map((o) => o.estimate)).toEqual([
			undefined,
			"15 requests: groq 15; tasks the team adds come on top",
			"15 requests: groq 15; tasks the team adds come on top",
			"15 requests: groq 15",
		]);
	});

	it("leaves out the line of an estimate that failed or never came", () => {
		const options = optionsOf(TEMPLATES, [GROQ, FAILED]);
		expect(options.map((o) => o.estimate)).toEqual([
			undefined,
			"15 requests: groq 15; tasks the team adds come on top",
			undefined,
			undefined,
		]);
	});

	it("still offers the router and a single agent when no template listed", () => {
		expect(optionsOf([], []).map((o) => o.key)).toEqual(["choose", "single"]);
	});
});

describe("narrowedTo", () => {
	const all = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);

	it("keeps the suggestions in the router's order with their lines, then a single agent, and drops the router's choice", () => {
		const narrowed = narrowedTo(["web-dev", "game-studio"], all);
		expect(narrowed.map((o) => o.key)).toEqual([
			"web-dev",
			"game-studio",
			"single",
		]);
		expect(narrowed[0]?.estimate).toContain("15 requests");
	});

	it("shows a suggestion the template list does not know by its id", () => {
		const narrowed = narrowedTo(["research"], all);
		expect(narrowed.map((o) => [o.key, o.label, o.templateId])).toEqual([
			["research", "research", "research"],
			["single", "Single agent", null],
		]);
	});
});

describe("startOf", () => {
	const option = (key: string) => {
		const found = optionsOf(TEMPLATES, []).find((o) => o.key === key);
		if (!found) throw new Error(key);
		return found;
	};

	it("sends only the goal when METE chooses, trimmed", () => {
		expect(startOf("  fix the bug ", option("choose"))).toEqual({
			goal: "fix the bug",
		});
	});

	it("sends the template picked, or null for a single agent", () => {
		expect(startOf("g", option("game-studio"))).toEqual({
			goal: "g",
			templateId: "game-studio",
		});
		expect(startOf("g", option("single"))).toEqual({
			goal: "g",
			templateId: null,
		});
	});
});
