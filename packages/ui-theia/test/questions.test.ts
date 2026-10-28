import { describe, expect, it } from "vitest";
import { questionsOf, withPick } from "../src/domain/questions.js";

// An agent's questions before its work (ADR-142) and the likely answers it offers (ADR-148).

describe("an agent's questions", () => {
	it("takes one question per line past a list marker, with the options its brackets offer", () => {
		expect(
			questionsOf("1. Which city? [Ankara | Izmir]\n\n- Which prices?"),
		).toEqual([
			{ text: "Which city?", options: ["Ankara", "Izmir"] },
			{ text: "Which prices?", options: [] },
		]);
	});

	it("keeps a bracket of fewer than two options, or one inside the line, as the question's text", () => {
		expect(questionsOf("Read the brief? [see docs]")).toEqual([
			{ text: "Read the brief? [see docs]", options: [] },
		]);
		expect(questionsOf("Use [React | Vue] for it?")).toEqual([
			{ text: "Use [React | Vue] for it?", options: [] },
		]);
		expect(questionsOf("[A | B]")).toEqual([{ text: "[A | B]", options: [] }]);
	});

	it("puts a pick on a line of its own, replacing an earlier pick for the same question", () => {
		const one = withPick("", "Which city?", "Ankara");
		expect(one).toBe("Which city? — Ankara");
		const two = withPick(`${one}\nNo budget yet.`, "Which size?", "Small");
		expect(two).toBe(
			"Which city? — Ankara\nNo budget yet.\nWhich size? — Small",
		);
		expect(withPick(two, "Which city?", "Izmir")).toBe(
			"Which city? — Izmir\nNo budget yet.\nWhich size? — Small",
		);
	});
});
