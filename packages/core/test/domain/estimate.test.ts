import { parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { estimateRequests } from "../../src/domain/estimate.js";

// The request estimate before a run starts (docs/09, Scheduler, step 6; ADR-068), without history.

const template = () => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "studio", name: "Studio", version: "1.0.0" },
		pattern: "hierarchical",
		roles: [
			{
				id: "lead",
				name: "Lead",
				goal: "Approve",
				tier: "reasoning",
				capabilities: [],
			},
			{
				id: "artist",
				name: "Artist",
				goal: "Draw",
				tier: "vision",
				needs: ["vision"],
				capabilities: [],
			},
			{
				id: "tester",
				name: "Tester",
				goal: "Test",
				tier: "fast",
				capabilities: [],
			},
		],
		tasks: [
			{ id: "plain", role: "tester", title: "Plain" },
			{ id: "art", role: "artist", title: "Art", approval: "lead" },
			{ id: "human", role: "tester", title: "Human", approval: "human" },
			{
				id: "paired",
				role: "artist",
				title: "Paired",
				review: { pair_with: "tester" },
			},
		],
	});
	if (!r.ok) throw new Error(r.error.issues.join("\n"));
	return r.value;
};

describe("estimateRequests", () => {
	it("counts 12 per task on its role's seat and 3 per approval on the approver's", () => {
		expect(estimateRequests(template())).toEqual([
			{ tier: "fast", needs: [], requests: 12 },
			{ tier: "vision", needs: ["vision"], requests: 12 },
			{ tier: "reasoning", needs: [], requests: 3 },
			// A human approves without a model request.
			{ tier: "fast", needs: [], requests: 12 },
			// Core does not run pair review yet (docs/08), so the review term adds nothing.
			{ tier: "vision", needs: ["vision"], requests: 12 },
		]);
	});

	it("counts one task on the single agent's seat when no template is given", () => {
		expect(estimateRequests(null)).toEqual([
			{ tier: "coder", needs: ["tool_calling"], requests: 12 },
		]);
	});
});
