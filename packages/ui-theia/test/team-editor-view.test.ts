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
	onAddMember: nothing,
	onRemoveMember: nothing,
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
	...more,
});
const html = (model: TeamEditorModel) =>
	renderToStaticMarkup(
		createElement(TeamEditorView, { model, actions: ACTIONS }),
	);

describe("TeamEditorView", () => {
	it("shows the team, each member with its tier and capabilities, and that a built-in team is saved as a copy", () => {
		const out = html(ready(DOC));
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
		// The members that came with the file keep their ids; four members, four fixed id fields.
		expect(out.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
	});

	it("tells a new member with no task how to give it work, and blocks Save on the schema's issues", () => {
		const doc = addRole(DOC);
		const out = html(ready(doc));
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
	const game = html(ready(GAME.value, { fixedIds: [] }));

	it("shows a task's verify command, and the team's revision limit and budget", () => {
		expect(html(ready(DOC))).toContain('title="Remove npm run build"');
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
