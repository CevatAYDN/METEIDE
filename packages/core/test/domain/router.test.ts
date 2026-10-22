import { parseTemplate, type TeamTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { routeOf } from "../../src/domain/router.js";

const research = (): TeamTemplate => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "research", name: "Research", version: "1.0.0" },
		pattern: "single",
		roles: [{ id: "w", name: "W", goal: "g", tier: "fast", capabilities: [] }],
		tasks: [{ id: "t", role: "w", title: "T" }],
	});
	if (!r.ok) throw new Error("template");
	return r.value;
};

const route = (reply: unknown) => routeOf(JSON.stringify(reply), [research()]);

describe("router", () => {
	it("sends a confident team answer to its template and a single one to one agent", () => {
		expect(
			route({ mode: "team", templateId: "research", confidence: 0.9 }),
		).toEqual({
			kind: "team",
			templateId: "research",
		});
		expect(route({ mode: "single", confidence: 0.8 })).toEqual({
			kind: "single",
		});
	});

	it("lets the user choose below 0.7", () => {
		expect(
			route({ mode: "team", templateId: "research", confidence: 0.5 }),
		).toEqual({
			kind: "choose",
			suggestions: ["research"],
		});
		expect(route({ mode: "single", confidence: 0.2 })).toEqual({
			kind: "choose",
			suggestions: ["research"],
		});
	});

	it("falls back to a single agent for a reply that is no route or names no template", () => {
		expect(routeOf("a team, I think", [research()]).kind).toBe("fallback");
		expect(
			route({ mode: "team", templateId: "seo", confidence: 0.9 }).kind,
		).toBe("fallback");
	});
});
