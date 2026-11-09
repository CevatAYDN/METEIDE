import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { canEditSkill } from "../src/application/skill-state.js";
import { SkillsView } from "../src/application/skills-view.js";
import { skillEntry, skillList } from "./skill-fixture.js";

it("offers editing only when the host supplies a real editor action", () => {
	const model = {
		state: {
			phase: "ready" as const,
			busy: false,
			inventory: skillList.ok ? skillList.value : undefined,
		},
		onRefresh: vi.fn(),
		onReview: vi.fn(),
		onApprove: vi.fn(),
		onDisable: vi.fn(),
		onDismiss: vi.fn(),
		onRecover: vi.fn(),
	};
	expect(
		renderToStaticMarkup(createElement(SkillsView, { model })),
	).not.toContain("Edit SKILL.md");
	expect(
		renderToStaticMarkup(
			createElement(SkillsView, {
				model: { ...model, onEdit: vi.fn() },
			}),
		),
	).toContain("Edit SKILL.md");
});

it("permits metadata repair but not unsafe or unavailable sources", () => {
	expect(canEditSkill(skillEntry)).toBe(true);
	expect(
		canEditSkill({
			...skillEntry,
			status: "invalid",
			diagnostics: [{ code: "bad_input", location: "frontmatter" }],
		}),
	).toBe(true);
	for (const location of ["root", "path", "source", "sha256", "utf8"] as const)
		expect(
			canEditSkill({
				...skillEntry,
				status: "invalid",
				diagnostics: [{ code: "bad_input", location }],
			}),
		).toBe(false);
	for (const status of ["missing", "unavailable"] as const)
		expect(canEditSkill({ ...skillEntry, status })).toBe(false);
	expect(
		canEditSkill({ ...skillEntry, status: "invalid", diagnostics: [] }),
	).toBe(false);
});
