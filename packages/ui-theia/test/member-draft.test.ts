import type { DaemonMemberDraftResult } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	draftEdits,
	draftIdea,
	withDraft,
} from "../src/application/member-draft.js";
import { addRole, blankDraft, teamOf } from "../src/application/team-draft.js";

// What the team editor's Draft button does with a draft (ADR-108): pure edits on the editor's doc,
// so the user reviews every field before Save writes anything.

const DRAFT = (
	over: Partial<DaemonMemberDraftResult>,
): DaemonMemberDraftResult => ({
	goal: "Builds and keeps the service.",
	backstory: "Has shipped small services.",
	task: { title: "Build the API" },
	sources: ["https://example.com/backend"],
	...over,
});

describe("draftIdea", () => {
	it("names the member by its name and the goal the user began", () => {
		const idea = draftIdea({
			id: "backend",
			name: "Backend developer",
			goal: "Builds the API",
			backstory: undefined,
			tier: "coder",
			needs: [],
			capabilities: [],
			prefer_different_family_than: [],
			watches: [],
		});
		expect(idea).toBe("Backend developer: Builds the API");
	});

	it("falls back to the id, and works without a goal", () => {
		const idea = draftIdea({
			id: "backend_dev",
			name: "",
			goal: "",
			backstory: undefined,
			tier: "coder",
			needs: [],
			capabilities: [],
			prefer_different_family_than: [],
			watches: [],
		});
		expect(idea).toBe("backend_dev");
	});
});

describe("draftEdits", () => {
	it("always edits the goal, and the backstory only when the draft has one", () => {
		expect(draftEdits(2, DRAFT({}))).toEqual([
			{ path: ["roles", 2, "goal"], value: "Builds and keeps the service." },
			{ path: ["roles", 2, "backstory"], value: "Has shipped small services." },
		]);
		expect(draftEdits(0, DRAFT({ backstory: undefined }))).toEqual([
			{ path: ["roles", 0, "goal"], value: "Builds and keeps the service." },
		]);
	});
});

describe("withDraft", () => {
	it("fills the member's fields; its task already exists, so the draft adds none", () => {
		const doc = blankDraft("my-team", "My team");
		const next = withDraft(doc, 0, DRAFT({}));
		const team = teamOf(next);
		expect(team.roles[0]?.goal).toBe("Builds and keeps the service.");
		expect(team.roles[0]?.backstory).toBe("Has shipped small services.");
		expect(team.tasks).toHaveLength(1);
	});

	it("adds no second task when one already names the member", () => {
		let doc = blankDraft("my-team", "My team");
		doc = withDraft(doc, 0, DRAFT({ task: undefined }));
		const before = teamOf(doc).tasks.length;
		const next = withDraft(doc, 0, DRAFT({}));
		expect(teamOf(next).tasks.length).toBe(before);
	});

	it("gives a member with no task its first task with the drafted title", () => {
		let doc = blankDraft("my-team", "My team");
		doc = addRole(doc);
		const added = teamOf(doc).roles[1]?.id ?? "";
		const next = withDraft(doc, 1, DRAFT({}));
		const task = teamOf(next).tasks.find((t) => t.role === added);
		expect(task?.title).toBe("Build the API");
	});
});
