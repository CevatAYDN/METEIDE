import { describe, expect, it } from "vitest";
import { estimateText } from "../src/application/estimate-text.js";

// The composer's estimate line (ADR-068): the total, then each provider's share and what no ready
// provider takes; a team's line says that tasks the team adds come on top.

describe("the composer's estimate", () => {
	it("names each provider's requests and the unassigned ones, in the order given", () => {
		const providers = [
			{ providerId: "nvidia", requests: 36 },
			{ providerId: "groq", requests: 9 },
		];
		expect(estimateText({ providers, unassigned: 12 }, false)).toBe(
			"57 requests: nvidia 36 · groq 9 · 12 unassigned",
		);
		expect(estimateText({ providers, unassigned: 0 }, false)).toBe(
			"45 requests: nvidia 36 · groq 9",
		);
	});

	it("says when no provider is ready, and adds the team's own tasks for a template", () => {
		expect(estimateText({ providers: [], unassigned: 12 }, false)).toBe(
			"12 requests, no provider ready",
		);
		expect(
			estimateText(
				{ providers: [{ providerId: "groq", requests: 15 }], unassigned: 0 },
				true,
			),
		).toBe("15 requests: groq 15; tasks the team adds come on top");
	});
});
