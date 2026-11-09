import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SkillState } from "../src/application/skill-session.js";
import { SkillsView } from "../src/application/skills-view.js";
import {
	approvedSkill,
	skillEntry,
	skillList,
	skillPreview,
} from "./skill-fixture.js";

const actions = {
	onRefresh: async () => {},
	onReview: async () => {},
	onApprove: async () => {},
	onDisable: async () => {},
	onRecover: async () => {},
	onDismiss: () => {},
};
const html = (state: SkillState) =>
	renderToStaticMarkup(
		createElement(SkillsView, { model: { ...actions, state } }),
	);
const ready: SkillState = {
	phase: "ready",
	busy: false,
	inventory: skillList.ok ? skillList.value : undefined,
};

it("keeps idle, loading, empty, failed, incomplete and recovery distinct", () => {
	expect(html({ phase: "idle", busy: false })).toContain(">Discover</button>");
	const loading = html({ phase: "loading", busy: false });
	expect(loading).toContain("Discovering skills...");
	expect(loading).not.toContain("No skills found");
	const empty = html({
		...ready,
		inventory: {
			sessionId: "session",
			entries: [],
			complete: true,
			diagnostics: [],
		},
	});
	expect(empty).toContain("No skills found.");
	const failed = html({
		phase: "error",
		busy: false,
		error: { code: "transport" },
	});
	expect(failed).toContain('role="alert"');
	expect(failed).not.toContain("No skills found");
	const incomplete = html({
		...ready,
		inventory: {
			sessionId: "session",
			entries: [],
			complete: false,
			diagnostics: [{ code: "limit_exceeded" }],
		},
	});
	expect(incomplete).toContain("Discovery is incomplete");
	expect(incomplete).not.toContain("No skills found");
	const recovery = html({
		...ready,
		phase: "recovery",
		error: { code: "transport" },
	});
	expect(recovery).toContain(">Recover and refresh</button>");
	expect(recovery).toContain("Outcome uncertain");
});

it("renders source-qualified rows, states, diagnostics and no S2 loaded/used claims", () => {
	const entries = [
		skillEntry,
		approvedSkill,
		{
			...skillEntry,
			source: {
				...skillEntry.source,
				sourceId: "c".repeat(64),
				scope: "global" as const,
			},
			status: "invalid" as const,
			diagnostics: [
				{ code: "bad_input" as const, location: "frontmatter" as const },
			],
		},
	];
	const out = html({
		...ready,
		inventory: {
			sessionId: "session",
			entries,
			complete: true,
			diagnostics: [],
		},
	});
	for (const text of [
		"Review fixture",
		"review-fixture/SKILL.md",
		"Workspace",
		"Global",
		"Unapproved",
		"Approved",
		"Invalid",
		"frontmatter",
	])
		expect(out).toContain(text);
	expect(out).toContain("data-skill-source=");
	expect(out).not.toMatch(/Used|Loaded|Install|Run script/);
});

it("renders the full masked SKILL.md only as escaped plaintext and names the raw-byte digest", () => {
	const out = html({
		...ready,
		preview: skillPreview.ok ? skillPreview.value : undefined,
	});
	expect(out).toContain("&lt;script&gt;masked plaintext&lt;/script&gt;");
	expect(out).not.toContain("<script>");
	expect(out).toContain("END OF FULL PREVIEW");
	expect(out).toContain("Raw file SHA-256");
	expect(out).toContain("b".repeat(64));
	expect(out).toMatch(
		/<textarea[^>]*aria-label="Masked SKILL.md"[^>]*readonly=""/i,
	);
	expect(out).toMatch(/<section[^>]*aria-label="Review"/);
	expect(out).toContain(">Approve</button>");
	expect(out).toContain("Expires");
});

it("deduplicates identical diagnostics but preserves distinct source and location evidence", () => {
	const out = html({
		...ready,
		inventory: {
			sessionId: "session",
			entries: [],
			complete: true,
			diagnostics: [
				{ code: "bad_input", sourceId: "a".repeat(64), location: "name" },
				{ code: "bad_input", sourceId: "a".repeat(64), location: "name" },
				{ code: "bad_input", sourceId: "b".repeat(64), location: "name" },
				{ code: "bad_input", sourceId: "a".repeat(64), location: "body" },
			],
		},
	});
	expect(out.match(/Invalid source or request\./g)).toHaveLength(3);
	expect(out.match(/<code>name<\/code>/g)).toHaveLength(2);
	expect(out).toContain(`<code>${"b".repeat(64)}</code>`);
	expect(out).toContain("<code>body</code>");
});

it("blocks busy/failed evidence and incomplete review but permits acknowledged revocation", () => {
	const inventory = {
		sessionId: "session",
		entries: [approvedSkill],
		complete: true,
		diagnostics: [],
	};
	for (const state of [
		{ ...ready, inventory, busy: true },
		{ ...ready, inventory, phase: "error" as const },
		{ ...ready, inventory: { ...inventory, complete: false } },
	]) {
		const out = html(state);
		expect(out).toMatch(/disabled=""[^>]*><span[^>]*><\/span>Review<\/button>/);
		if (state.inventory.complete === false)
			expect(out).not.toMatch(
				/disabled=""[^>]*><span[^>]*><\/span>Disable<\/button>/,
			);
		else
			expect(out).toMatch(
				/disabled=""[^>]*><span[^>]*><\/span>Disable<\/button>/,
			);
	}
	expect(
		html({
			...ready,
			inventory: {
				...inventory,
				entries: [{ ...approvedSkill, status: "disabled" }],
			},
		}),
	).not.toContain(">Disable</button>");
});

it("exposes unavailable historical receipt revocation despite the inventory limit", () => {
	const state: SkillState = {
		...ready,
		inventory: {
			sessionId: "session",
			complete: false,
			entries: [
				{
					source: approvedSkill.source,
					status: "unavailable",
					revision: approvedSkill.revision,
					approvedSha256: "b".repeat(64),
					diagnostics: [{ code: "limit_exceeded" }],
				},
			],
			diagnostics: [{ code: "limit_exceeded" }],
		},
		preview: skillPreview.ok ? skillPreview.value : undefined,
	};
	const out = html(state);
	expect(out).toContain("Unavailable");
	expect(out).toContain("Discovery is incomplete");
	expect(out).toMatch(/disabled=""[^>]*><span[^>]*><\/span>Review<\/button>/);
	expect(out).toMatch(/disabled=""[^>]*><span[^>]*><\/span>Approve<\/button>/);
	expect(out).not.toMatch(
		/disabled=""[^>]*><span[^>]*><\/span>Disable<\/button>/,
	);
	for (const blocked of [
		{ ...state, busy: true },
		{ ...state, phase: "error" as const },
	])
		expect(html(blocked)).toMatch(
			/disabled=""[^>]*><span[^>]*><\/span>Disable<\/button>/,
		);
});
