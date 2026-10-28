import { err, type ModelRef, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	type ChainContext,
	type EstimateReply,
	fetchChain,
	loadRoles,
	modelRefOf,
	narrowedTo,
	optionsOf,
	preferOf,
	settledChoice,
	singleAgentModels,
	startOf,
	withEstimate,
} from "../src/application/composer.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

// The composer's list and the request Start sends, without Theia (ADR-058, ADR-068, ADR-071).

const TEMPLATES = [
	{
		id: "game-studio",
		name: "Game studio",
		description: "Idea to playable prototype",
	},
	{ id: "web-dev", name: "Web development" },
];
const GROQ: EstimateReply = {
	ok: true,
	value: { providers: [{ providerId: "groq", requests: 15 }], unassigned: 0 },
};
const FAILED: EstimateReply = {
	ok: false,
	error: { code: "stopped", detail: "x" },
};

describe("an estimate asked again with the run's model choice (ADR-155)", () => {
	it("replaces one option's line, and leaves it out when the answer failed", () => {
		const NOXERY: EstimateReply = {
			ok: true,
			value: {
				providers: [{ providerId: "custom:noxery", requests: 12 }],
				unassigned: 0,
			},
		};
		const options = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);
		expect(
			withEstimate(options, "single", NOXERY).map((o) => o.estimate),
		).toEqual([
			undefined,
			"15 requests: groq 15; tasks the team adds come on top",
			"15 requests: groq 15; tasks the team adds come on top",
			"12 requests: custom:noxery 12",
		]);
		expect(
			withEstimate(options, "web-dev", FAILED)[2]?.estimate,
		).toBeUndefined();
	});

	it("is asked once a typed choice is one of the listed models, or cleared", () => {
		const listed = ["custom:noxery/glm-5.3-flash", "nvidia/m"];
		expect(settledChoice("custom:noxery/glm-5.3-flash", listed)).toBe(true);
		expect(settledChoice("", listed)).toBe(true);
		expect(settledChoice("custom:noxery/glm", listed)).toBe(false);
		expect(settledChoice("nvidia/m", undefined)).toBe(false);
	});
});

describe("optionsOf", () => {
	it("lists the router's choice, each template with its description, then a single agent", () => {
		const options = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);
		expect(options.map((o) => [o.key, o.label, o.description])).toEqual([
			["choose", "Let METE choose", undefined],
			["game-studio", "Game studio", "Idea to playable prototype"],
			["web-dev", "Web development", undefined],
			["single", "Single agent", undefined],
		]);
		expect(options.map((o) => o.templateId)).toEqual([
			undefined,
			"game-studio",
			"web-dev",
			null,
		]);
	});

	it("gives each team and the single agent its estimate line, and none to the router's choice", () => {
		const options = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);
		expect(options.map((o) => o.estimate)).toEqual([
			undefined,
			"15 requests: groq 15; tasks the team adds come on top",
			"15 requests: groq 15; tasks the team adds come on top",
			"15 requests: groq 15",
		]);
	});

	it("leaves out the line of an estimate that failed or never came", () => {
		const options = optionsOf(TEMPLATES, [GROQ, FAILED]);
		expect(options.map((o) => o.estimate)).toEqual([
			undefined,
			"15 requests: groq 15; tasks the team adds come on top",
			undefined,
			undefined,
		]);
	});

	it("still offers the router and a single agent when no template listed", () => {
		expect(optionsOf([], []).map((o) => o.key)).toEqual(["choose", "single"]);
	});
});

describe("narrowedTo", () => {
	const all = optionsOf(TEMPLATES, [GROQ, GROQ, GROQ]);

	it("keeps the suggestions in the router's order with their lines, then a single agent, and drops the router's choice", () => {
		const narrowed = narrowedTo(["web-dev", "game-studio"], all);
		expect(narrowed.map((o) => o.key)).toEqual([
			"web-dev",
			"game-studio",
			"single",
		]);
		expect(narrowed[0]?.estimate).toContain("15 requests");
	});

	it("shows a suggestion the template list does not know by its id", () => {
		const narrowed = narrowedTo(["research"], all);
		expect(narrowed.map((o) => [o.key, o.label, o.templateId])).toEqual([
			["research", "research", "research"],
			["single", "Single agent", null],
		]);
	});
});

describe("startOf", () => {
	const option = (key: string) => {
		const found = optionsOf(TEMPLATES, []).find((o) => o.key === key);
		if (!found) throw new Error(key);
		return found;
	};

	it("sends only the goal when METE chooses, trimmed", () => {
		expect(startOf("  fix the bug ", option("choose"))).toEqual({
			goal: "fix the bug",
		});
	});

	it("sends the template picked, or null for a single agent", () => {
		expect(startOf("g", option("game-studio"))).toEqual({
			goal: "g",
			templateId: "game-studio",
		});
		expect(startOf("g", option("single"))).toEqual({
			goal: "g",
			templateId: null,
		});
	});

	it("passes prefer for a single agent when provided, or omits it when absent", () => {
		const single = option("single");
		expect(
			startOf("g", single, { providerId: "groq", modelId: "llama" }),
		).toEqual({
			goal: "g",
			templateId: null,
			prefer: { providerId: "groq", modelId: "llama" },
		});
		expect(startOf("g", single, undefined)).toEqual({
			goal: "g",
			templateId: null,
		});
	});

	it("passes prefer for a team when provided, or omits it when empty", () => {
		const team = option("game-studio");
		expect(
			startOf("g", team, {
				lead: { providerId: "groq", modelId: "llama" },
			}),
		).toEqual({
			goal: "g",
			templateId: "game-studio",
			prefer: { lead: { providerId: "groq", modelId: "llama" } },
		});
		expect(startOf("g", team, {})).toEqual({
			goal: "g",
			templateId: "game-studio",
		});
	});

	it("omits prefer and templateId when METE chooses", () => {
		expect(
			startOf("g", option("choose"), {
				lead: { providerId: "groq", modelId: "llama" },
			}),
		).toEqual({
			goal: "g",
		});
	});

	it("omits prefer if prefer type mismatches the option kind", () => {
		const single = option("single");
		const team = option("game-studio");
		// Single agent given a team record prefer: omitted
		expect(
			startOf("g", single, {
				lead: { providerId: "groq", modelId: "llama" },
			}),
		).toEqual({
			goal: "g",
			templateId: null,
		});
		// Team given a single ModelRef prefer: omitted
		expect(
			startOf("g", team, { providerId: "groq", modelId: "llama" }),
		).toEqual({
			goal: "g",
			templateId: "game-studio",
		});
	});
});

describe("modelRefOf", () => {
	it("parses valid providerId/modelId strings", () => {
		expect(modelRefOf("groq/llama-3.3-70b-versatile")).toEqual({
			providerId: "groq",
			modelId: "llama-3.3-70b-versatile",
		});
		expect(modelRefOf("openrouter/anthropic/claude-3.5-sonnet")).toEqual({
			providerId: "openrouter",
			modelId: "anthropic/claude-3.5-sonnet",
		});
		expect(modelRefOf("  gemini/gemini-2.0-flash  ")).toEqual({
			providerId: "gemini",
			modelId: "gemini-2.0-flash",
		});
	});

	it("returns undefined for invalid strings", () => {
		expect(modelRefOf(undefined)).toBeUndefined();
		expect(modelRefOf("")).toBeUndefined();
		expect(modelRefOf("   ")).toBeUndefined();
		expect(modelRefOf("noslash")).toBeUndefined();
		expect(modelRefOf("/nomodel")).toBeUndefined();
		expect(modelRefOf("noprovider/")).toBeUndefined();
	});
});

describe("preferOf", () => {
	it("resolves single agent model preference", () => {
		expect(preferOf(null, "groq/llama")).toEqual({
			providerId: "groq",
			modelId: "llama",
		});
		expect(preferOf(null, "")).toBeUndefined();
		expect(preferOf(null, undefined)).toBeUndefined();
		expect(preferOf(null, "invalid")).toBeUndefined();
	});

	it("resolves team role model preferences", () => {
		expect(
			preferOf("web-dev", undefined, {
				lead: "groq/llama",
				dev: "gemini/flash",
			}),
		).toEqual({
			lead: { providerId: "groq", modelId: "llama" },
			dev: { providerId: "gemini", modelId: "flash" },
		});
		expect(
			preferOf("web-dev", undefined, {
				lead: "groq/llama",
				dev: "",
			}),
		).toEqual({
			lead: { providerId: "groq", modelId: "llama" },
		});
		expect(preferOf("web-dev", undefined, {})).toBeUndefined();
		expect(preferOf("web-dev", undefined, { lead: "" })).toBeUndefined();
	});

	it("filters out roles not present in allowedRoles", () => {
		expect(
			preferOf(
				"web-dev",
				undefined,
				{
					lead: "groq/llama",
					dev: "gemini/flash",
					stale_role: "groq/llama",
				},
				["lead", "dev"],
			),
		).toEqual({
			lead: { providerId: "groq", modelId: "llama" },
			dev: { providerId: "gemini", modelId: "flash" },
		});
		expect(
			preferOf("web-dev", undefined, { stale_role: "groq/llama" }, [
				"lead",
				"dev",
			]),
		).toBeUndefined();
	});

	it("returns undefined when METE chooses", () => {
		expect(
			preferOf(undefined, "groq/llama", { lead: "groq/llama" }),
		).toBeUndefined();
	});
});

const fakeDaemon = (
	overrides?: Partial<MeteDaemonService>,
): MeteDaemonService =>
	({
		chain: vi.fn(async () =>
			ok({
				models: [
					{ providerId: "groq", modelId: "llama-3.3-70b-versatile" },
					{ providerId: "gemini", modelId: "gemini-2.0-flash" },
				] as readonly ModelRef[],
			}),
		),
		readTemplate: vi.fn(async (_dir: string, id: string) =>
			ok({
				id,
				source: "workspace" as const,
				yaml: `metadata:\n  id: ${id}\n  name: ${id}\nroles:\n  - id: lead\n    name: Lead\n    tier: coder\n  - id: dev\n    name: Developer\n    tier: fast\n`,
			}),
		),
		...overrides,
	}) as unknown as MeteDaemonService;

describe("fetchChain", () => {
	it("fetches and caches models for a valid tier", async () => {
		const daemon = fakeDaemon();
		const ctx: ChainContext = {
			daemon,
			dir: "/workspace",
			cache: new Map(),
		};
		const models = await fetchChain(ctx, "coder", []);
		expect(models).toEqual([
			"groq/llama-3.3-70b-versatile",
			"gemini/gemini-2.0-flash",
		]);
		expect(daemon.chain).toHaveBeenCalledTimes(1);

		// Second call uses cache
		const cached = await fetchChain(ctx, "coder", []);
		expect(cached).toEqual(models);
		expect(daemon.chain).toHaveBeenCalledTimes(1);
	});

	it("returns empty array for invalid tier without calling daemon", async () => {
		const daemon = fakeDaemon();
		const ctx: ChainContext = {
			daemon,
			dir: "/workspace",
			cache: new Map(),
		};
		expect(await fetchChain(ctx, "invalid_tier", [])).toEqual([]);
		expect(daemon.chain).not.toHaveBeenCalled();
	});

	it("handles daemon failure gracefully", async () => {
		const daemon = fakeDaemon({
			chain: vi.fn(async () =>
				err({ code: "refused" as const, detail: "no chain" }),
			),
		});
		const ctx: ChainContext = {
			daemon,
			dir: "/workspace",
			cache: new Map(),
		};
		expect(await fetchChain(ctx, "coder", [])).toEqual([]);
	});

	it("handles undefined needsList safely", async () => {
		const daemon = fakeDaemon();
		const ctx: ChainContext = {
			daemon,
			dir: "/workspace",
			cache: new Map(),
		};
		expect(await fetchChain(ctx, "coder", undefined)).toHaveLength(2);
	});
});

describe("singleAgentModels", () => {
	it("asks the coder chain for tool calling, as the single agent needs it", async () => {
		const daemon = fakeDaemon();
		await singleAgentModels({ daemon, dir: "/workspace", cache: new Map() });
		expect(daemon.chain).toHaveBeenCalledWith("/workspace", "coder", [
			"tool_calling",
		]);
	});
});

describe("loadRoles", () => {
	it("enriches templates with roles and models from chain", async () => {
		const daemon = fakeDaemon();
		const ctx: ChainContext = {
			daemon,
			dir: "/workspace",
			cache: new Map(),
		};
		const enriched = await loadRoles(ctx, [
			{ id: "game-studio", name: "Game Studio" },
		]);
		expect(enriched).toHaveLength(1);
		expect(enriched[0]?.roles).toHaveLength(2);
		expect(enriched[0]?.roles?.[0]?.id).toBe("lead");
		expect(enriched[0]?.roles?.[0]?.models).toEqual([
			"groq/llama-3.3-70b-versatile",
			"gemini/gemini-2.0-flash",
		]);
	});

	it("returns template unchanged when readTemplate fails", async () => {
		const daemon = fakeDaemon({
			readTemplate: vi.fn(async () =>
				err({ code: "refused" as const, detail: "missing" }),
			),
		});
		const ctx: ChainContext = {
			daemon,
			dir: "/workspace",
			cache: new Map(),
		};
		const enriched = await loadRoles(ctx, [{ id: "missing", name: "Missing" }]);
		expect(enriched[0]?.roles).toBeUndefined();
	});
});
