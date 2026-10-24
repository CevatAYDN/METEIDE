import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	stateLook,
	TeamView,
	tierLabel,
} from "../src/application/team-view.js";
import type { Member } from "../src/domain/roster.js";

// The Team view's rows (ADR-089) rendered to HTML on Node.

const agent = {
	id: "a1",
	roleId: "frontend_developer",
	providerId: "groq",
	modelId: "llama-3.3-70b",
	tier: "coder" as const,
	thinking: false,
};

describe("the Team view", () => {
	it("draws a row per member with its name, tier label and id, model, state and tasks", () => {
		const members: Member[] = [
			{
				roleId: "frontend_developer",
				agent,
				state: { kind: "working", tool: "fs.write@1" },
				now: { task: "Build the page" },
				done: 0,
				total: 1,
			},
			{
				roleId: "qa",
				agent: {
					...agent,
					id: "a2",
					providerId: "nvidia",
					modelId: "nvidia/nemotron",
				},
				state: { kind: "idle" },
				now: { task: "Audit it", waitsFor: "Build the page" },
				done: 0,
				total: 1,
			},
		];
		const out = renderToStaticMarkup(
			createElement(TeamView, { members, names: { qa: "QA" } }),
		);
		expect(out).toContain('aria-label="Frontend developer"');
		expect(out).toContain('aria-label="QA"');
		expect(out).toContain(">Coder<");
		expect(out).toContain('title="coder"');
		expect(out).toContain("groq · llama-3.3-70b");
		// The provider is not written twice when the model id repeats it.
		expect(out).toContain("nvidia · nemotron<");
		expect(out).toContain("Working with fs.write");
		expect(out).toContain("Audit it · waits for “Build the page”");
		expect(out).toContain(
			"Members: 2 · working: 1 · waiting for you: 0 · done: 0",
		);
	});

	it("gives every state an icon and a word, and every tier a plain label", () => {
		const looks = [
			stateLook({ kind: "waits_for_you" }),
			stateLook({ kind: "quota", resetsAt: "2026-10-24T18:00:00.000Z" }),
			stateLook({ kind: "thinking" }),
			stateLook({ kind: "blocked" }),
			stateLook({ kind: "done" }),
			stateLook({ kind: "idle" }),
		];
		expect(looks.map((l) => [l.icon, l.tone])).toEqual([
			["bell", "warn"],
			["watch", "warn"],
			["loading", "accent"],
			["circle-slash", "bad"],
			["pass", "good"],
			["circle-outline", "muted"],
		]);
		expect(looks[1]?.text).toMatch(/^Waiting for quota until \d/);
		expect(looks[2]?.spin).toBe(true);
		expect(
			(["reasoning", "coder", "fast", "long-context", "vision"] as const).map(
				tierLabel,
			),
		).toEqual(["Thinker", "Coder", "Fast", "Long reads", "Sees images"]);
	});
});
