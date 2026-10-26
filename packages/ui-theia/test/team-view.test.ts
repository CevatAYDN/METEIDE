import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { tokenCount } from "../src/application/numbers.js";
import {
	commitModel,
	ModelChoice,
	ModelChoiceField,
	RevertButton,
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

describe("team-view model selection (ADR-122)", () => {
	it("commits a model the run does not already prefer, and never null on blur", () => {
		const spy = vi.fn();
		const committed = commitModel(
			"developer",
			"groq/llama-3.3-70b",
			undefined,
			spy,
		);
		expect(spy).toHaveBeenCalledWith("developer", {
			providerId: "groq",
			modelId: "llama-3.3-70b",
		});
		expect(committed).toBe("groq/llama-3.3-70b");

		// An empty field sends nothing: only Revert clears the run's preference (ADR-122).
		spy.mockClear();
		expect(commitModel("developer", "", "groq/llama-3.3-70b", spy)).toBe(
			"groq/llama-3.3-70b",
		);
		expect(commitModel("developer", "   ", undefined, spy)).toBeUndefined();
		expect(spy).not.toHaveBeenCalled();

		spy.mockClear();
		commitModel("developer", "invalid-model", undefined, spy);
		expect(spy).not.toHaveBeenCalled();

		// The model the run already prefers is a no-op request.
		spy.mockClear();
		commitModel("developer", "groq/llama-3.3-70b", "groq/llama-3.3-70b", spy);
		expect(spy).not.toHaveBeenCalled();

		expect(() =>
			commitModel("developer", "groq/llama-3.3-70b", undefined, undefined),
		).not.toThrow();
	});

	it("renders model input with datalist candidates and revert button when preferredModel is set", () => {
		const members: Member[] = [
			{
				roleId: "developer",
				agent,
				state: { kind: "idle" },
				done: 0,
				total: 1,
			},
		];
		const onModel = vi.fn();
		const out = renderToStaticMarkup(
			createElement(TeamView, {
				members,
				names: { developer: "Developer" },
				windows: {},
				candidateModels: {
					developer: ["groq/llama-3.3-70b", "gemini/gemini-2.0-flash"],
				},
				preferredModels: { developer: "groq/llama-3.3-70b" },
				onModel,
			}),
		);
		expect(out).toContain("Preferred model (optional)");
		expect(out).toContain('value="groq/llama-3.3-70b"');
		expect(out).toContain('<option value="gemini/gemini-2.0-flash"');
		expect(out).toContain("Revert to default");
		expect(out).toContain('title="Change model"');
	});

	it("omits model input when onModel is not provided", () => {
		const members: Member[] = [
			{
				roleId: "developer",
				agent,
				state: { kind: "idle" },
				done: 0,
				total: 1,
			},
		];
		const out = renderToStaticMarkup(
			createElement(TeamView, {
				members,
				names: { developer: "Developer" },
				windows: {},
				candidateModels: { developer: ["groq/llama-3.3-70b"] },
			}),
		);
		expect(out).not.toContain("Preferred model (optional)");
		expect(out).not.toContain("Revert to default");
	});

	it("falls back to member agent tier candidate models when role candidateModels is missing", () => {
		const members: Member[] = [
			{
				roleId: "specialist",
				agent, // tier is "coder"
				state: { kind: "idle" },
				done: 0,
				total: 1,
			},
		];
		const onModel = vi.fn();
		const out = renderToStaticMarkup(
			createElement(TeamView, {
				members,
				names: { specialist: "Specialist" },
				windows: {},
				candidateModels: { coder: ["groq/llama-3.3-70b"] },
				onModel,
			}),
		);
		expect(out).toContain('<option value="groq/llama-3.3-70b"');
		expect(out).not.toContain("Revert to default");
	});

	it("renders single-agent member with model selection and preferred model", () => {
		const members: Member[] = [
			{
				roleId: "assistant",
				agent: { ...agent, roleId: "assistant" },
				state: { kind: "working", tool: "fs.read" },
				done: 0,
				total: 0,
			},
		];
		const onModel = vi.fn();
		const out = renderToStaticMarkup(
			createElement(TeamView, {
				members,
				names: {},
				windows: {},
				candidateModels: { assistant: ["openrouter/auto"] },
				preferredModels: { assistant: "openrouter/auto" },
				onModel,
			}),
		);
		expect(out).toContain("Assistant");
		expect(out).toContain('value="openrouter/auto"');
		expect(out).toContain("Revert to default");
	});

	it("invokes ModelChoiceField events: onChange, onKeyDown, onBlur", () => {
		const onDraft = vi.fn();
		const onCommit = vi.fn();
		const field = ModelChoiceField({
			roleId: "developer",
			draft: "groq/llama",
			models: ["groq/llama-3.3-70b"],
			onDraft,
			onCommit,
		});

		const input = field.props.children[1];
		// 1. onChange with non-candidate model updates draft only
		input.props.onChange({ target: { value: "gemini/flash" } });
		expect(onDraft).toHaveBeenCalledWith("gemini/flash");
		expect(onCommit).not.toHaveBeenCalled();

		// 2. onChange with candidate model updates draft and commits
		input.props.onChange({ target: { value: "groq/llama-3.3-70b" } });
		expect(onDraft).toHaveBeenCalledWith("groq/llama-3.3-70b");
		expect(onCommit).toHaveBeenCalledWith("groq/llama-3.3-70b");

		// 3. onKeyDown with Enter commits draft
		onCommit.mockClear();
		input.props.onKeyDown({ key: "Enter" });
		expect(onCommit).toHaveBeenCalledWith("groq/llama");

		// 4. onKeyDown with other keys does not commit
		onCommit.mockClear();
		input.props.onKeyDown({ key: "Escape" });
		expect(onCommit).not.toHaveBeenCalled();

		// 5. onBlur commits draft
		onCommit.mockClear();
		input.props.onBlur();
		expect(onCommit).toHaveBeenCalledWith("groq/llama");
	});

	it("invokes RevertButton onClick and prevents default on mouseDown", () => {
		const onRevert = vi.fn();
		const button = RevertButton({ onRevert });
		const preventDefault = vi.fn();
		button.props.onMouseDown({ preventDefault });
		expect(preventDefault).toHaveBeenCalled();
		button.props.onClick();
		expect(onRevert).toHaveBeenCalled();
	});

	it("ModelChoice renders revert button when model is set and omits it when empty", () => {
		const onModel = vi.fn();
		const withModel = renderToStaticMarkup(
			createElement(ModelChoice, {
				roleId: "writer",
				value: "groq/llama-3.3-70b",
				models: ["groq/llama-3.3-70b"],
				onModel,
			}),
		);
		expect(withModel).toContain("Revert to default");

		const withoutModel = renderToStaticMarkup(
			createElement(ModelChoice, {
				roleId: "writer",
				value: undefined,
				models: ["groq/llama-3.3-70b"],
				onModel,
			}),
		);
		expect(withoutModel).not.toContain("Revert to default");
	});
});
