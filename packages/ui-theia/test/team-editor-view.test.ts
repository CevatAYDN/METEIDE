import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { optionsOf } from "../src/application/composer.js";
import { ComposerView } from "../src/application/composer-view.js";
import {
	addRole,
	type Draft,
	draftOf,
	issuesOf,
	removeRole,
	teamOf,
} from "../src/application/team-draft.js";
import {
	type TeamEditorActions,
	type TeamEditorModel,
	TeamEditorView,
} from "../src/application/team-editor-view.js";

// The team editor rendered to HTML on Node: no DOM and no Theia widget (ADR-075).

const WEB_DEV = readFileSync(
	join(__dirname, "..", "..", "..", "templates", "web-dev.yaml"),
	"utf8",
);
const loaded = draftOf(WEB_DEV);
if (!loaded.ok) throw new Error(loaded.error);
const DOC = loaded.value;
const IDS = teamOf(DOC).roles.map((r) => r.id);
const nothing = () => {};
const ACTIONS: TeamEditorActions = {
	onEdit: nothing,
	onSelectMember: nothing,
	onAddMember: nothing,
	onRemoveMember: nothing,
	onRenameMember: nothing,
	onPin: nothing,
	onAddTask: nothing,
	onRemoveTask: nothing,
	onSave: nothing,
	onSaveAs: nothing,
	onOpenYaml: nothing,
};
const ready = (
	doc: Draft,
	more: Partial<Extract<TeamEditorModel, { kind: "ready" }>> = {},
): TeamEditorModel => ({
	kind: "ready",
	team: teamOf(doc),
	source: "builtIn",
	fixedIds: IDS,
	issues: issuesOf(doc),
	busy: false,
	changed: true,
	selected: 0,
	pins: {},
	chains: {},
	...more,
});
// Each member's form shows when its tile is chosen (ADR-093): this renders the screen once for each.
const everyMember = (
	doc: Draft,
	more: Partial<Extract<TeamEditorModel, { kind: "ready" }>> = {},
) =>
	teamOf(doc)
		.roles.map((_, selected) => html(ready(doc, { ...more, selected })))
		.join("");
const html = (model: TeamEditorModel) =>
	renderToStaticMarkup(
		createElement(TeamEditorView, { model, actions: ACTIONS }),
	);

describe("TeamEditorView", () => {
	it("shows the team, each member's form with its tier and capabilities, and that a built-in team is saved as a copy", () => {
		const out = html(ready(DOC, { selected: 1 }));
		for (const text of [
			"Web development",
			"UI designer",
			"Frontend developer",
			"fs.*@1 ×",
			"Model tier",
			"never a provider or model",
			"writes your copy to .mete/teams/web-dev.yaml",
			"Add member",
			"Save as new team",
		])
			expect(out).toContain(text);
		expect(out).not.toContain('role="alert"');
		// A member that came with the file keeps its id: the chosen member's id field is fixed.
		expect(out).toMatch(
			/<input class="mete-field" disabled="" value="frontend_developer"/,
		);
	});

	it("shows only the chosen member's form beside the grid of every member's tile", () => {
		const out = html(ready(DOC, { selected: 2 }));
		// One form: one Remove member button and one Id field, for QA.
		expect(out.match(/Remove member/g)).toHaveLength(1);
		expect(out).toMatch(/disabled="" value="qa"/);
		expect(out).not.toMatch(/<input[^>]*value="frontend_developer"/);
		// Four tiles, one for each member; the chosen tile is pressed.
		expect(
			out.match(/<button type="button" class="mete-card"[^>]*aria-pressed/g),
		).toHaveLength(4);
		expect(
			out.match(/class="mete-card"[^>]*aria-pressed="true"/g),
		).toHaveLength(1);
	});

	it("says in each tile who the member is, its tier in plain words and whether it has work", () => {
		const doc = addRole(DOC);
		const out = html(ready(doc, { selected: 0 }));
		expect(out).toMatch(
			/<strong[^>]*>UI designer<\/strong><\/span><span[^>]*>Thinker<\/span><span[^>]*>[^<]*<\/span><span[^>]*>1 task<\/span>/,
		);
		expect(out).toMatch(
			/<strong[^>]*>Frontend developer<\/strong><\/span><span[^>]*>Coder</,
		);
		// The member just added has no task and a goal and name still to write: its tile shows its id.
		expect(out).toMatch(/<strong[^>]*>member<\/strong>/);
		expect(out).toContain(">No task yet<");
	});

	it("offers the five tiers as tiles with their plain labels and ids, the member's own pressed", () => {
		const out = html(ready(DOC, { selected: 0 }));
		for (const text of [
			"Thinker",
			"Coder",
			"Fast",
			"Long reads",
			"Sees images",
		])
			expect(out).toContain(text);
		for (const id of ["reasoning", "coder", "fast", "long-context", "vision"])
			expect(out).toContain(`>${id}</span>`);
		// UI designer's tier is reasoning: its tile is pressed and no select is left.
		expect(out).toMatch(/aria-pressed="true"><span[^>]*><\/span> Thinker/);
		expect(out).not.toContain('<option value="reasoning"');
	});

	it("tells a new member with no task how to give it work, and blocks Save on the schema's issues", () => {
		const doc = addRole(DOC);
		const out = html(ready(doc, { selected: 4 }));
		expect(out).toContain("No task names this member yet");
		expect(out).toContain('role="alert"');
		expect(out).toContain("roles.4.goal");
		expect(out).toMatch(
			/<button type="button" class="mete-button" disabled="">Save</,
		);
	});

	it("opens the YAML only once the team is the folder's own file", () => {
		const openYaml = (source: "workspace" | "builtIn") =>
			html(ready(DOC, { source })).match(/<button[^>]*>Open YAML/)?.[0];
		expect(openYaml("builtIn")).toContain('disabled=""');
		expect(openYaml("workspace")).not.toContain('disabled=""');
	});

	it("says how to pick a team when it shows none, as after a restart that had no team open", () => {
		expect(html({ kind: "none" })).toContain("METE: Edit team");
	});

	it("saves an unchanged built-in team as the folder's copy, and an unchanged copy not again", () => {
		const save = (source: "workspace" | "builtIn") =>
			html(ready(DOC, { source, changed: false })).match(
				/<button[^>]*>Save</,
			)?.[0];
		expect(save("builtIn")).not.toContain('disabled=""');
		expect(save("workspace")).toContain('disabled=""');
	});
});

describe("the rules of the work", () => {
	const GAME = draftOf(
		readFileSync(
			join(__dirname, "..", "..", "..", "templates", "game-studio.yaml"),
			"utf8",
		),
	);
	if (!GAME.ok) throw new Error(GAME.error);
	const game = everyMember(GAME.value, { fixedIds: [] });

	it("shows a task's verify command, and the team's revision limit and budget", () => {
		expect(html(ready(DOC, { selected: 1 }))).toContain(
			'title="Remove npm run build"',
		);
		for (const text of [
			"Revisions per task",
			"Cloud requests per run",
			"Hours per run",
			"never raises your limit",
		])
			expect(game).toContain(text);
	});

	it("shows a guardrail with its repairs, the human checkpoint after a role, and the task list that spawns tasks", () => {
		expect(game).toContain('value="gdd@1"');
		const ticked = '<input type="checkbox" checked=""/>';
		expect(game).toContain(`${ticked}You approve it too, after the approver`);
		expect(game).toContain(`${ticked}Its approved task list`);
	});

	it("shows what a task list gives each member once a task spawns, and not in a team where none does", () => {
		expect(game.match(/Tasks a task list gives this member/g)).toHaveLength(6);
		expect(html(ready(DOC))).not.toContain(
			"Tasks a task list gives this member",
		);
	});
});

describe("a member's pinned model (ADR-077)", () => {
	it("shows the pin and the tier's models for a member of the file, and asks a new member to wait for Save", () => {
		const doc = addRole(DOC);
		const more = {
			pins: { qa: "groq/fast-one" },
			chains: { "coder|tool_calling": ["groq/fast-one", "nvidia/big"] },
		};
		const qa = html(ready(doc, { ...more, selected: IDS.indexOf("qa") }));
		expect(qa).toContain("Pinned model (optional)");
		expect(qa).toContain('value="groq/fast-one"');
		expect(qa).toContain('<option value="nvidia/big">');
		expect(qa).toContain("not the team file");
		expect(qa).not.toContain("Save the team to pin this member");
		const added = html(ready(doc, { ...more, selected: IDS.length }));
		expect(added.match(/Save the team to pin this member/g)).toHaveLength(1);
	});

	it("says how to get a list when the tier offers no model", () => {
		expect(html(ready(DOC))).toContain("add a provider key");
	});
});

describe("the composer's Edit button", () => {
	it("sits beside each team and not beside the router's choice or the single agent", () => {
		const out = renderToStaticMarkup(
			createElement(ComposerView, {
				model: {
					kind: "ready",
					options: optionsOf([{ id: "web-dev", name: "Web" }], []),
					unsure: false,
				},
				goal: "",
				selected: "choose",
				busy: false,
				onGoal: nothing,
				onSelect: nothing,
				onStart: nothing,
				onEdit: nothing,
			}),
		);
		expect(out.match(/>Edit</g)).toHaveLength(1);
	});
});

describe("Order of work (ADR-093)", () => {
	it("lists the tasks in the order a run can start them, with who does each and who approves it", () => {
		const out = html(ready(DOC));
		expect(out).toContain("Order of work");
		const rows = [
			...out.matchAll(
				/<li><button[^>]*class="mete-card"[^>]*>(.*?)<\/button><\/li>/g,
			),
		];
		expect(rows).toHaveLength(3);
		expect(rows[0]?.[1]).toMatch(
			/>1<\/span><strong>[^<]+<\/strong><span>UI designer<\/span>/,
		);
		expect(rows[1]?.[1]).toContain("<span>Frontend developer</span>");
		expect(rows[1]?.[1]).toContain("after ");
		expect(rows[2]?.[1]).toContain("approved by Lead");
	});

	it("says that the human approves a task, and has no list for a team without tasks", () => {
		const game = draftOf(
			readFileSync(
				join(__dirname, "..", "..", "..", "templates", "game-studio.yaml"),
				"utf8",
			),
		);
		if (!game.ok) throw new Error(game.error);
		expect(html(ready(game.value))).toContain("then by you");
		const you = draftOf(
			`roles: [{ id: r, name: R }]
tasks: [{ id: a, role: r, title: A, approval: human }]`,
		);
		if (!you.ok) throw new Error(you.error);
		expect(html(ready(you.value))).toContain("you approve it");
		const none = draftOf("roles: []\ntasks: []");
		if (!none.ok) throw new Error(none.error);
		expect(html(ready(none.value, { selected: -1 }))).not.toContain(
			"Order of work",
		);
	});

	it("keeps Add member and the schema's refusal when the last member has been removed", () => {
		let doc = DOC;
		for (let i = 0; i < IDS.length; i++) doc = removeRole(doc, 0);
		const out = html(ready(doc, { selected: -1 }));
		expect(out).toContain("Add member");
		expect(out).toContain('role="alert"');
		expect(out).not.toContain("Remove member");
		expect(out).toMatch(
			/<button type="button" class="mete-button" disabled="">Save</,
		);
	});
});
