import type { DaemonMemberDraftResult } from "@mete/contracts";
import {
	addTask,
	type Draft,
	edited,
	type MemberView,
	teamOf,
} from "./team-draft.js";

// What the team editor's Draft button does with `mete/member.draft`'s answer (ADR-108): the idea a
// draft starts from, and the edits it offers. Everything is applied to the editor's draft only, so
// the user reviews the fields before Save writes anything to the folder.

/** The idea a draft starts from: the member's name, and its goal when the user began one. */
export const draftIdea = (member: MemberView): string =>
	[member.name || member.id, member.goal]
		.filter(Boolean)
		.join(": ")
		.slice(0, 200);

/** One edit of a draft: where it lands in the template and what it says. */
export type DraftEdit = {
	readonly path: readonly (string | number)[];
	readonly value: unknown;
};

/** A draft's edits: the goal always (that is the point), the backstory when it has one. */
export const draftEdits = (
	index: number,
	draft: DaemonMemberDraftResult,
): readonly DraftEdit[] => [
	{ path: ["roles", index, "goal"], value: draft.goal },
	...(draft.backstory === undefined
		? []
		: [{ path: ["roles", index, "backstory"], value: draft.backstory }]),
];

/** The draft applied to the editor's doc: its edits, and its task when the member owns none yet. */
export const withDraft = (
	doc: Draft,
	index: number,
	draft: DaemonMemberDraftResult,
): Draft => {
	let next = doc;
	for (const e of draftEdits(index, draft))
		next = edited(next, e.path, e.value);
	const member = teamOf(next).roles[index];
	if (
		member &&
		draft.task &&
		!teamOf(next).tasks.some((t) => t.role === member.id)
	) {
		next = addTask(next, member.id);
		next = edited(
			next,
			["tasks", teamOf(next).tasks.length - 1, "title"],
			draft.task.title,
		);
	}
	return next;
};
