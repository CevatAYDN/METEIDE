import { parseTemplate, type TeamTemplate } from "@mete/contracts";
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
			{
				id: "plain",
				role: "tester",
				title: "Plain",
				before_start: { clarify_with: "lead" },
			},
			{ id: "art", role: "artist", title: "Art", approval: "lead" },
			{
				id: "human",
				role: "tester",
				title: "Human",
				approval: "human",
				before_start: { clarify_with: "human" },
			},
			{
				id: "paired",
				role: "artist",
				title: "Paired",
				review: { pair_with: "tester" },
				memory: { write_lessons: true },
			},
		],
	});
	if (!r.ok) throw new Error(r.error.issues.join("\n"));
	return r.value;
};

describe("estimateRequests", () => {
	it("counts 12 per task on its role's seat, 4 per clarification on the answering role's, 4 per review on the pair's, 3 per approval on the approver's and 1 per lesson on the task's role's, naming the role for its pin", () => {
		expect(estimateRequests(template())).toEqual([
			{ roleId: "tester", tier: "fast", needs: [], requests: 12 },
			// A role answers the questions asked before the work (ADR-142).
			{ roleId: "lead", tier: "reasoning", needs: [], requests: 4 },
			{ roleId: "artist", tier: "vision", needs: ["vision"], requests: 12 },
			{ roleId: "lead", tier: "reasoning", needs: [], requests: 3 },
			// A human approves, and answers, without a model request.
			{ roleId: "tester", tier: "fast", needs: [], requests: 12 },
			{ roleId: "artist", tier: "vision", needs: ["vision"], requests: 12 },
			// Core runs pair review (ADR-136), so the review term counts.
			{ roleId: "tester", tier: "fast", needs: [], requests: 4 },
			// The lesson after approval is one request of the task's agent (ADR-145).
			{ roleId: "artist", tier: "vision", needs: ["vision"], requests: 1 },
		]);
	});

	it("counts a best-of-N task's work n times on its role's seat and 1 request for its judge, which has no role (ADR-162)", () => {
		const t = template();
		const human = t.tasks.find((x) => x.id === "human");
		if (!human) throw new Error("no human task");
		const best = (n: number) =>
			estimateRequests({
				...t,
				tasks: [
					{
						...human,
						attempts: { n, distinct_families: true, judge_tier: "reasoning" },
					},
				],
			});
		expect(best(3)).toEqual([
			{ roleId: "tester", tier: "fast", needs: [], requests: 36 },
			{ tier: "reasoning", needs: [], requests: 1 },
		]);
		expect(best(1)).toEqual([
			{ roleId: "tester", tier: "fast", needs: [], requests: 12 },
		]);
	});

	it("counts 1 query embedding per start of a team task's work when embedding is on, never for the single agent (ADR-152)", () => {
		const t = template();
		const [plain] = t.tasks;
		if (!plain) throw new Error("no task");
		const attempts = {
			n: 2,
			distinct_families: false,
			judge_tier: "fast",
		} as const;
		const embeds = (tasks: TeamTemplate["tasks"], embed: boolean) =>
			estimateRequests({ ...t, tasks }, embed).filter((e) => "embed" in e);
		expect(embeds([plain, { ...plain, attempts }], true)).toEqual([
			{ embed: true, requests: 1 },
			{ embed: true, requests: 2 },
		]);
		expect(embeds([plain], false)).toEqual([]);
		expect(estimateRequests(null, true)).toEqual([
			{ tier: "coder", needs: ["tool_calling"], requests: 12 },
		]);
	});

	it("counts one task on the single agent's seat when no template is given", () => {
		expect(estimateRequests(null)).toEqual([
			{ tier: "coder", needs: ["tool_calling"], requests: 12 },
		]);
	});
});
