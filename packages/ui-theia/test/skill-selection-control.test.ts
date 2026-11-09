import type { SkillPolicy } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
	canSelectSkillVersion,
	changeSkillMode,
	SkillSelectionControl,
	toggleSelectedSkill,
} from "../src/application/skill-selection.js";

const entry = (n: number, scope: "workspace" | "global" = "workspace") => ({
	version: {
		sourceId: String(n).repeat(64),
		sha256: "b".repeat(64),
		revision: n,
	},
	source: { sourceId: String(n).repeat(64), scope, path: "review/SKILL.md" },
	name: "review",
	description: `Review workflow ${n}`,
});

it("preserves exact selection order and caps explicit selections at four", () => {
	const entries = [1, 2, 3, 4, 5].map((n) => entry(n));
	let policy: SkillPolicy = { mode: "manual", selected: [] };
	for (const item of entries.slice(0, 4))
		policy = toggleSelectedSkill(policy, item.version, true);
	expect(policy.selected).toEqual(
		entries.slice(0, 4).map(({ version }) => version),
	);
	expect(canSelectSkillVersion(policy, entries[4]?.version)).toBe(false);
	expect(toggleSelectedSkill(policy, entries[4]?.version, true)).toEqual(
		policy,
	);
	expect(
		toggleSelectedSkill(policy, entries[1]?.version, false).selected,
	).toEqual([entries[0]?.version, entries[2]?.version, entries[3]?.version]);
});

it("clears explicit selections only when switching to off", () => {
	const selected = [entry(1).version];
	expect(changeSkillMode({ mode: "auto", selected }, "manual")).toEqual({
		mode: "manual",
		selected,
	});
	expect(changeSkillMode({ mode: "manual", selected }, "off")).toEqual({
		mode: "off",
		selected: [],
	});
});

it("renders source-qualified workspace/global options and stale selections without shadowing", () => {
	const html = renderToStaticMarkup(
		createElement(SkillSelectionControl, {
			policy: {
				mode: "manual",
				selected: [
					{ sourceId: "9".repeat(64), sha256: "c".repeat(64), revision: 2 },
				],
			},
			catalog: {
				status: "ready",
				entries: [entry(1, "workspace"), entry(2, "global")],
				diagnostics: [],
			},
			onMode: () => {},
			onToggle: () => {},
		}),
	);
	expect(html).toContain("Workspace · review/SKILL.md · r1");
	expect(html).toContain("Global · review/SKILL.md · r2");
	expect(html).toContain("999999999999");
	expect(html).not.toContain("Approve");
	expect(html).not.toContain("Disable");
});

it("distinguishes an unavailable catalog from an empty ready catalog", () => {
	const empty = renderToStaticMarkup(
		createElement(SkillSelectionControl, {
			policy: { mode: "auto", selected: [] },
			catalog: { status: "ready", entries: [], diagnostics: [] },
			onMode: () => {},
			onToggle: () => {},
		}),
	);
	const unavailable = renderToStaticMarkup(
		createElement(SkillSelectionControl, {
			policy: { mode: "auto", selected: [] },
			catalog: {
				status: "unavailable",
				entries: [],
				diagnostics: [{ code: "budget_exceeded" }],
			},
			onMode: () => {},
			onToggle: () => {},
		}),
	);
	expect(empty).toContain("No approved skills");
	expect(unavailable).toContain("Skill catalog unavailable");
});
