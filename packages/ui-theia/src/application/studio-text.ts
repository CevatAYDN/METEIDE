import type { MeteEvent } from "@mete/contracts";
import { nameOf, type TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";

// The Studio's accessible list (docs/13: every visual event is also written to a list): one sentence
// per event of the studio table, in the words of what the room shows. One literal nls.localize call
// per sentence, so Theia's nls-extract can read each text.

const taskOf = (view: TeamView, e: MeteEvent) =>
	view.tasks.find((t) => t.id === e.taskId)?.title ?? "";

/** The words for the agent of an attempt of a best-of-N task, on the canvas and beside it (ADR-162). */
export const attemptName = (roleId: string, k: number, n: number) =>
	nls.localize("mete/studio/attempt", "{0} · attempt {1}/{2}", roleId, k, n);

// The event's agent by its id, the first thought's too (docs/07). An older run's first thought has no
// id, and a call whose agent was never made has an id no agent has: then the role of the task's agent
// stands in, with no attempt. A single agent has no task on either side.
const roleOf = (view: TeamView, e: MeteEvent) => {
	const a = view.agents.find((x) => x.id === e.agentId);
	if (a) return nameOf(a, { attempt: attemptName });
	return view.agents.find((x) => x.taskId === e.taskId)?.roleId ?? "";
};

type Status = Extract<
	MeteEvent,
	{ type: "task.status.changed" }
>["payload"]["to"];

// The Board's words for a status: its column, or the marker it carries there.
const statusWord = (status: Status) =>
	({
		todo: nls.localize("mete/board/todo", "To do"),
		in_progress: nls.localize("mete/board/inProgress", "In progress"),
		submitted: nls.localize("mete/board/inReview", "In review"),
		changes_requested: nls.localize("mete/board/changesAsked", "Changes asked"),
		blocked: nls.localize("mete/board/blocked", "Blocked"),
		approved: nls.localize("mete/board/done", "Done"),
	})[status];

const statusText = (
	e: Extract<MeteEvent, { type: "task.status.changed" }>,
	task: string,
) => {
	if (e.payload.to === "approved")
		return nls.localize(
			"mete/studio/approved",
			"{0} is approved and moves to Done.",
			task,
		);
	if (e.payload.to === "changes_requested")
		return nls.localize(
			"mete/studio/changesAsked",
			"{0} goes back to its agent with changes asked.",
			task,
		);
	if (e.payload.to === "blocked")
		return nls.localize("mete/studio/blocked", "{0} is blocked.", task);
	return nls.localize(
		"mete/studio/moved",
		"{0} is now {1}.",
		task,
		statusWord(e.payload.to),
	);
};

const runText = (e: MeteEvent, view: TeamView): string | undefined => {
	if (e.type === "run.paused")
		return e.payload.reason === "network"
			? nls.localize(
					"mete/studio/offline",
					"The network is down; the room dims.",
				)
			: nls.localize(
					"mete/studio/paused",
					"The run is paused: {0}.",
					e.payload.reason,
				);
	if (e.type === "run.completed")
		return nls.localize(
			"mete/studio/completed",
			"The run is complete; everyone celebrates.",
		);
	if (e.type === "approval.requested")
		return e.payload.approver === "human"
			? nls.localize(
					"mete/studio/asksYou",
					"{0} waits for your approval.",
					taskOf(view, e),
				)
			: nls.localize(
					"mete/studio/asksRole",
					"{0} asks {1} for approval.",
					taskOf(view, e),
					e.payload.approver,
				);
	if (e.type === "review.requested")
		return nls.localize(
			"mete/studio/asksReview",
			"{0} asks {1} for a review.",
			taskOf(view, e),
			e.payload.reviewerRoleId,
		);
	return undefined;
};

const quotaText = (e: MeteEvent): string | undefined => {
	if (e.type === "quota.exhausted")
		return nls.localize(
			"mete/studio/quotaOut",
			"{0}'s free quota is used up; its agents wait at the coffee corner.",
			e.payload.providerId,
		);
	if (e.type === "quota.restored")
		return nls.localize(
			"mete/studio/quotaBack",
			"{0}'s quota is back; its agents return to their desks.",
			e.payload.providerId,
		);
	return undefined;
};

// A message names its agents by id; a role id stands in for an agent not made yet.
const nameById = (view: TeamView, id: string) => {
	const a = view.agents.find((x) => x.id === id);
	return a ? nameOf(a, { attempt: attemptName }) : id;
};

const noteText = (e: MeteEvent, view: TeamView): string | undefined => {
	if (e.type === "agent.message.sent")
		return nls.localize(
			"mete/studio/message",
			"{0} sends {1} a message: “{2}”",
			nameById(view, e.payload.from),
			nameById(view, e.payload.to),
			e.payload.summary,
		);
	if (e.type === "vault.note.saved")
		return nls.localize(
			"mete/studio/noteSaved",
			"{0} is saved in the vault; a book flies to the shelf.",
			e.payload.path,
		);
	return undefined;
};

/** The sentence the Studio's list shows for an event of the studio table. */
export const studioText = (view: TeamView, e: MeteEvent): string => {
	switch (e.type) {
		case "task.created":
			return nls.localize(
				"mete/studio/created",
				"A note for {0} drops into To do.",
				taskOf(view, e),
			);
		case "task.assigned":
			return nls.localize(
				"mete/studio/assigned",
				"{0} goes to an agent.",
				taskOf(view, e),
			);
		case "task.status.changed":
			return statusText(e, taskOf(view, e));
		case "agent.thinking.started":
			return nls.localize(
				"mete/studio/thinking",
				"{0} is thinking.",
				roleOf(view, e),
			);
		case "agent.tool.called":
			return nls.localize(
				"mete/studio/tool",
				"{0} uses {1}.",
				roleOf(view, e),
				e.payload.capability,
			);
		default:
			return runText(e, view) ?? quotaText(e) ?? noteText(e, view) ?? e.type;
	}
};
