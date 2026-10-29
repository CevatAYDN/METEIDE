import { describe, expect, it } from "vitest";
import { estimateLine } from "../src/application/estimate-text.js";

// The composer's estimate (ADR-068) as the Composer board draws it (ADR-128): the total, then each
// provider's share and what no ready provider takes as chips; a team's says that tasks the team adds
// come on top.

describe("the composer's estimate", () => {
	it("names each provider's requests and the unassigned ones, in the order given", () => {
		const providers = [
			{ providerId: "nvidia", requests: 36 },
			{ providerId: "groq", requests: 9 },
		];
		expect(estimateLine({ providers, unassigned: 12 }, false)).toEqual({
			total: "57 requests",
			shares: [
				{ text: "nvidia 36" },
				{ text: "groq 9" },
				{ text: "12 unassigned", unassigned: true },
			],
		});
		expect(estimateLine({ providers, unassigned: 0 }, false)).toEqual({
			total: "45 requests",
			shares: [{ text: "nvidia 36" }, { text: "groq 9" }],
		});
	});

	it("says when no provider is ready, and adds the team's own tasks for a template", () => {
		expect(estimateLine({ providers: [], unassigned: 12 }, false)).toEqual({
			total: "12 requests, no provider ready",
			shares: [],
		});
		expect(
			estimateLine(
				{ providers: [{ providerId: "groq", requests: 15 }], unassigned: 0 },
				true,
			),
		).toEqual({
			total: "15 requests",
			shares: [{ text: "groq 15" }],
			note: "tasks the team adds come on top",
		});
	});
});
