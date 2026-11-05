import { describe, expect, it } from "vitest";
import {
	stateText,
	unusableLead,
	unusableWhy,
} from "../src/application/quota-text.js";

// A provider's state in words (ADR-050): a custom endpoint's key is set on its card, since
// "METE: Set provider key" lists the built-in providers only (ADR-154).

describe("a provider's state in words", () => {
	it("points a custom endpoint without a key at its card", () => {
		expect(stateText({ id: "custom:lab", state: "no_key" })).toBe(
			"custom:lab: no key (Settings, its endpoint card, Set key)",
		);
		expect(stateText({ id: "nvidia", state: "no_key" })).toBe(
			"nvidia: no key (METE: Set provider key)",
		);
	});

	it("says an unusable provider's key is set, then its causes, in one text elsewhere", () => {
		const text = stateText({ id: "groq", state: "unusable" });
		expect(text).toBe(`${unusableLead("groq")} ${unusableWhy()}`);
		expect(text).toContain(
			"groq: its key is set, but none of its models can be used in this folder. Its model list did not load",
		);
	});
});
