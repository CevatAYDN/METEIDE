import type { ModelInfo, ProviderState } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	chipsOf,
	nextActive,
	pickList,
	startActive,
	valuesOf,
} from "../src/application/model-pick.js";
import {
	ModelPicker,
	PickNote,
	PickOptions,
} from "../src/application/model-picker.js";

// The model picker of ADR-161: the role's chain under a heading per provider with each model's
// facts, Use “…” for a typed id, and the keys of the open list.

const info = (
	providerId: string,
	id: string,
	more: Partial<ModelInfo> = {},
): ModelInfo => ({
	id,
	providerId,
	family: "",
	contextWindow: 0,
	toolCalling: false,
	vision: false,
	free: false,
	deprecated: false,
	...more,
});

const CHAIN = [
	"custom:noxery/glm-5.3-flash",
	"nvidia/qwen/qwen3-coder",
	"custom:noxery/mimo-v2.6-pro",
	"groq/openai/gpt-oss-120b",
];
const FACTS = [
	info("custom:noxery", "glm-5.3-flash", {
		family: "zhipu",
		free: true,
		contextWindow: 1_000_000,
		toolCalling: true,
	}),
	info("nvidia", "qwen/qwen3-coder", {
		family: "qwen",
		contextWindow: 262_000,
	}),
	info("groq", "openai/gpt-oss-120b", {
		price: { input: 0.15, output: 0.6 },
		vision: true,
		toolCalling: "unknown",
	}),
];
const STATES: ProviderState[] = [
	{ id: "custom:noxery", state: "ready" },
	{ id: "nvidia", state: "exhausted", resetsAt: "2026-10-30T18:00:00.000Z" },
];

describe("the model picker's list", () => {
	it("groups the chain by provider in the order of its first model, keeping the chain's order", () => {
		const list = pickList(CHAIN, FACTS, STATES, "");
		expect(list.groups.map((g) => g.providerId)).toEqual([
			"custom:noxery",
			"nvidia",
			"groq",
		]);
		expect(list.groups[0]?.models.map((m) => m.modelId)).toEqual([
			"glm-5.3-flash",
			"mimo-v2.6-pro",
		]);
		expect(valuesOf(list)).toEqual([
			null,
			"custom:noxery/glm-5.3-flash",
			"custom:noxery/mimo-v2.6-pro",
			"nvidia/qwen/qwen3-coder",
			"groq/openai/gpt-oss-120b",
		]);
	});

	it("gives a provider that is not ready its state, and a ready one none", () => {
		const [noxery, nvidia, groq] = pickList(CHAIN, FACTS, STATES, "").groups;
		expect(noxery?.state).toBeUndefined();
		expect(nvidia?.state?.state).toBe("exhausted");
		expect(groq?.state).toBeUndefined();
	});

	it("says free or the price, the context window, and tools and vision only when they are known", () => {
		expect(chipsOf(FACTS[0])).toEqual(["free", "1M", "tools"]);
		expect(chipsOf(FACTS[1])).toEqual(["262k"]);
		expect(chipsOf(FACTS[2])).toEqual(["$0.15 / $0.6", "vision"]);
		expect(chipsOf(undefined)).toEqual([]);
	});

	it("filters by the id or the family, without case", () => {
		const ids = (q: string) =>
			valuesOf(pickList(CHAIN, FACTS, STATES, q)).slice(1);
		expect(ids("GLM")).toEqual(["custom:noxery/glm-5.3-flash"]);
		expect(ids("qwen")).toEqual(["nvidia/qwen/qwen3-coder"]);
		expect(ids("Zhipu")).toEqual(["custom:noxery/glm-5.3-flash"]);
		expect(ids("noxery")).toHaveLength(2);
	});

	it("offers a typed full id the chain does not hold, and not one it holds", () => {
		expect(
			pickList(CHAIN, FACTS, STATES, " custom:noxery/kimi-k2.6 ").use,
		).toBe("custom:noxery/kimi-k2.6");
		expect(
			pickList(CHAIN, FACTS, STATES, "groq/openai/gpt-oss-120b").use,
		).toBeUndefined();
		expect(pickList(CHAIN, FACTS, STATES, "claude").use).toBeUndefined();
	});

	it("opens on the chosen row, or Let METE choose, and after typing on the first match", () => {
		const values = valuesOf(pickList(CHAIN, FACTS, STATES, ""));
		expect(startActive(values, "nvidia/qwen/qwen3-coder", "")).toBe(3);
		expect(startActive(values, "", "")).toBe(0);
		expect(startActive(values, "someone/else", "")).toBe(0);
		expect(startActive(values, "x", "glm")).toBe(1);
		expect(startActive([null], "claude", "claude")).toBeUndefined();
	});

	it("moves with Up, Down, Home and End, stopping at the ends", () => {
		expect(nextActive("ArrowDown", undefined, 4)).toBe(0);
		expect(nextActive("ArrowDown", 3, 4)).toBe(3);
		expect(nextActive("ArrowUp", 0, 4)).toBe(0);
		expect(nextActive("ArrowUp", 2, 4)).toBe(1);
		expect(nextActive("Home", 2, 4)).toBe(0);
		expect(nextActive("End", 0, 4)).toBe(3);
		expect(nextActive("a", 0, 4)).toBeUndefined();
	});
});

const options = (query: string, value = "") =>
	renderToStaticMarkup(
		createElement(PickOptions, {
			id: "l",
			list: pickList(CHAIN, FACTS, STATES, query),
			value,
			query,
			active: 1,
			onPick: () => {},
		}),
	);

describe("the model picker's rows", () => {
	it("lists Let METE choose, a heading per provider, the state line and the chips", () => {
		const out = options("", "custom:noxery/glm-5.3-flash");
		expect(out).toContain(
			'id="l-0" class="mete-picker-opt" role="option" aria-selected="false"',
		);
		expect(out).toContain("Let METE choose");
		expect(out).toContain(
			'id="l-1" class="mete-picker-opt active" role="option" aria-selected="true"',
		);
		expect(out).toContain("codicon-check");
		expect(out).toContain('<span class="mete-picker-chip">1M</span>');
		expect(out).toContain(
			'role="group" aria-label="nvidia: its free quota is used up until',
		);
		expect(out).toContain('class="mete-picker-state"');
		expect(out).toContain('id="l-4"');
		expect(out).not.toContain('id="l-5"');
	});

	it("offers Use “…” for a typed id and says why nothing matches otherwise", () => {
		const use = options("custom:noxery/kimi-k2.6");
		expect(use).toContain('id="l-1"');
		expect(use).toContain("Use “custom:noxery/kimi-k2.6”");
		expect(use).toContain("Not listed for this role");
		// The listbox owns options only: the note why nothing matches sits beside it.
		expect(options("claude")).not.toContain('role="status"');
		const none = renderToStaticMarkup(
			createElement(PickNote, { query: "claude" }),
		);
		expect(none).toContain('role="status"');
		expect(none).toContain("No model matches “claude”.");
		expect(none).toContain("Settings, Models and keys");
	});

	it("draws a closed combobox that names its list", () => {
		const out = renderToStaticMarkup(
			createElement(ModelPicker, {
				id: "f",
				label: "Lead · Preferred model (optional)",
				value: "",
				models: [],
				facts: [],
				states: [],
				onChange: () => {},
				onPick: () => {},
			}),
		);
		expect(out).toMatch(
			/role="combobox" aria-expanded="false" aria-controls="([^"]+)"/,
		);
		const list = /aria-controls="([^"]+)"/.exec(out)?.[1];
		expect(out).toContain(`id="${list}"`);
		expect(out).toContain('class="mete-picker-list" hidden=""');
		expect(out).toContain(
			'role="listbox" aria-label="Lead · Preferred model (optional)"',
		);
		expect(out).toMatch(
			/<\/ul><p class="mete-picker-note" role="status">No model can serve this role now\./,
		);
	});
});
