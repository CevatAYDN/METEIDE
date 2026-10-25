import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { tokenCount } from "../src/application/numbers.js";
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
			createElement(TeamView, { members, names: { qa: "QA" }, windows: {} }),
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
			"Members: 2 · working: 1 · waiting for you: 0 · done: 0<",
		);
		// A run recorded before ADR-090 has no usage: no context line and nothing about tokens.
		expect(out).not.toContain("Tokens: ");
	});

	it("shows the latest call's context share with the counts, and the role's tokens (ADR-090)", () => {
		const used = (prompt: number, providerId = "groq") => ({
			...agent,
			providerId,
			usage: {
				calls: 3,
				tokens: 210_000,
				last: { prompt, providerId, modelId: "llama-3.3-70b" },
			},
		});
		const member = (a: Member["agent"], roleId: string): Member => ({
			roleId,
			...(a ? { agent: a } : {}),
			state: { kind: "idle" },
			done: 0,
			total: 0,
			...(a?.usage ? { used: { tokens: 250_000, calls: 4 } } : {}),
		});
		const out = renderToStaticMarkup(
			createElement(TeamView, {
				members: [
					member(used(61_440), "writer"),
					member(used(110_000, "nvidia"), "qa"),
					member(used(5_000, "custom:lab"), "lab"),
					member(used(500, "tiny"), "tiny"),
					member(agent, "idle"),
				],
				names: {},
				windows: {
					"groq/llama-3.3-70b": 128_000,
					"nvidia/llama-3.3-70b": 128_000,
					"tiny/llama-3.3-70b": 128_000,
				},
			}),
		);
		expect(out).toContain("Context 48% · 61k of 128k");
		expect(out).toContain("Tokens: 250k · calls: 4");
		// From 80% the bar takes the warning colour; the text still says the number.
		expect(out).toContain("Context 86% · 110k of 128k");
		// From 80% the meter takes the warning tone (ADR-107); the text still says the number.
		expect(out).toContain('class="mete-meter warn"');
		expect(out).toContain("--p:85.9375%");
		expect(out).toContain('class="mete-meter"');
		expect(out).toContain("--p:48%");
		// A model with no listed window shows the tokens alone, and a member with no usage nothing.
		expect(out.match(/Context /g)).toHaveLength(3);
		expect(out.match(/Tokens: /g)).toHaveLength(4);
		// A share that rounds to 0 still says some context is used.
		expect(out).toContain("Context &lt;1% · 500 of 128k");
		// The run's tokens and calls moved to the run strip (ADR-094): the Team view keeps its member counts only.
		expect(out).not.toContain("run tokens");
	});

	it("writes token counts with a fixed suffix", () => {
		expect(
			[999, 1_500, 61_440, 128_000, 999_700, 1_200_000].map(tokenCount),
		).toEqual(["999", "1.5k", "61k", "128k", "1M", "1.2M"]);
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
