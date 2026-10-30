import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	applyAll,
	applyEvent,
	EMPTY_TEAM_VIEW,
	placeOf,
	placeOfTask,
} from "../../src/domain/team-view.js";

// The fold over hand-written events: no daemon, no storage, only the catalog's shapes.

const RUN = crypto.randomUUID();
const WS = crypto.randomUUID();
const NOTES = crypto.randomUUID();
const SUMMARY = crypto.randomUUID();
const AGENT = crypto.randomUUID();

let clock = 0;
const event = (
	type: string,
	payload: object,
	taskId?: string,
	runId = RUN,
): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: new Date(Date.UTC(2026, 9, 23, 10, 0, clock++)).toISOString(),
		schema: 1,
		workspaceId: WS,
		runId,
		...(taskId ? { taskId } : {}),
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const created = (taskId: string, title: string, dependsOn: string[] = []) =>
	event("task.created", { title, roleId: "writer", dependsOn }, taskId);
const moved = (taskId: string, from: string, to: string) =>
	event("task.status.changed", { from, to }, taskId);

describe("the team view fold", () => {
	it("places each task by its status, with the agent it was assigned to", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event("run.started", {}),
			created(NOTES, "Take notes"),
			created(SUMMARY, "Summarize", [NOTES]),
			event("task.assigned", { agentId: AGENT }, NOTES),
			moved(NOTES, "todo", "in_progress"),
		]);
		expect(view.tasks).toEqual([
			{
				id: NOTES,
				title: "Take notes",
				roleId: "writer",
				dependsOn: [],
				agentId: AGENT,
				status: "in_progress",
			},
			{
				id: SUMMARY,
				title: "Summarize",
				roleId: "writer",
				dependsOn: [NOTES],
				status: "todo",
			},
		]);
	});

	it("applies an event once, so history and the live stream can overlap", () => {
		const history = [
			created(NOTES, "Take notes"),
			moved(NOTES, "todo", "in_progress"),
		];
		const once = applyAll(RUN, EMPTY_TEAM_VIEW, history);
		const twice = applyAll(RUN, once, history);
		expect(twice).toBe(once);
	});

	it("leaves out events of other runs and status changes of tasks it never saw", () => {
		const other = crypto.randomUUID();
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			event(
				"task.created",
				{ title: "Elsewhere", roleId: "x", dependsOn: [] },
				NOTES,
				other,
			),
			moved(SUMMARY, "todo", "in_progress"),
			event("task.assigned", { agentId: AGENT }, SUMMARY),
		]);
		expect(view.tasks).toEqual([]);
	});

	it("names the role that approves a task, but never the human", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			event("approval.requested", { approver: "lead" }, NOTES),
			event("approval.requested", { approver: "human" }, NOTES),
		]);
		expect(view.tasks[0]?.approver).toBe("lead");
	});

	it("marks a task while the human's decision is asked, after an approver role's too (ADR-091)", () => {
		const asked = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			event("approval.requested", { approver: "lead" }, NOTES),
			event(
				"approval.resolved",
				{ approver: "lead", decision: "approve" },
				NOTES,
			),
			event("approval.requested", { approver: "human" }, NOTES),
		]);
		expect(asked.tasks[0]).toMatchObject({
			approver: "lead",
			waitsForHuman: true,
		});
		const decided = applyAll(RUN, asked, [
			event(
				"approval.resolved",
				{ approver: "human", decision: "approve" },
				NOTES,
			),
		]);
		expect(decided.tasks[0]?.waitsForHuman).toBeUndefined();
		expect(decided.tasks[0]?.approver).toBe("lead");
	});

	it("keeps the worktree the human's request names until the human decides (ADR-132)", () => {
		const asked = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			event(
				"approval.requested",
				{ approver: "human", worktree: "/w/r/t" },
				NOTES,
			),
		]);
		expect(asked.tasks[0]?.worktree).toBe("/w/r/t");
		const decided = applyAll(RUN, asked, [
			event(
				"approval.resolved",
				{ approver: "human", decision: "approve" },
				NOTES,
			),
		]);
		expect(decided.tasks[0]?.worktree).toBeUndefined();
	});

	it("keeps the question a task asks before its work until it is answered, by a role or the human (ADR-142)", () => {
		const ask = (to: string) =>
			event(
				"task.clarification.requested",
				{ toRoleId: to, question: "Which city?" },
				NOTES,
			);
		const toRole = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			moved(NOTES, "todo", "in_progress"),
			ask("researcher"),
		]);
		expect(toRole.tasks[0]?.question).toEqual({
			to: "researcher",
			text: "Which city?",
		});
		const answer = {
			messageId: crypto.randomUUID(),
			from: AGENT,
			to: AGENT,
			kind: "answer",
			summary: "Ankara.",
		};
		const answered = applyAll(RUN, toRole, [
			event("agent.message.sent", answer, NOTES),
		]);
		expect(answered.tasks[0]?.question).toBeUndefined();
		const toHuman = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			moved(NOTES, "todo", "in_progress"),
			ask("human"),
			moved(NOTES, "in_progress", "blocked"),
		]);
		expect(toHuman.tasks[0]?.question?.to).toBe("human");
		const back = applyAll(RUN, toHuman, [
			moved(NOTES, "blocked", "in_progress"),
		]);
		expect(back.tasks[0]?.question).toBeUndefined();
	});

	it("keeps the files the human's latest request lists until the human decides (ADR-141)", () => {
		const ask = (payload: object) =>
			event("approval.requested", { approver: "human", ...payload }, NOTES);
		const listed = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			ask({ worktree: "/w/r/t", files: ["index.html"] }),
		]);
		expect(listed.tasks[0]?.files).toEqual(["index.html"]);
		// A request asked again without a list does not keep the older one.
		const again = applyAll(RUN, listed, [ask({ worktree: "/w/r/t" })]);
		expect(again.tasks[0]?.files).toBeUndefined();
		const decided = applyAll(RUN, listed, [
			event(
				"approval.resolved",
				{ approver: "human", decision: "approve" },
				NOTES,
			),
		]);
		expect(decided.tasks[0]?.files).toBeUndefined();
	});

	it("keeps the files of the run's latest handoff (ADR-133)", () => {
		const handoff = (files?: string[]) =>
			event("handoff.created", {
				handoffId: crypto.randomUUID(),
				...(files ? { files } : {}),
			});
		const paused = applyAll(RUN, EMPTY_TEAM_VIEW, [handoff(["design/a.html"])]);
		expect(paused.files).toEqual(["design/a.html"]);
		const ended = applyAll(RUN, paused, [handoff(["design/a.html", "a.html"])]);
		expect(ended.files).toEqual(["design/a.html", "a.html"]);
		expect(applyAll(RUN, ended, [handoff()]).files).toBeUndefined();
	});

	it("marks a blocked task as waiting for the human, and clears it when the task goes back to work", () => {
		const working = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			moved(NOTES, "todo", "in_progress"),
		]);
		expect(working.tasks[0]?.waitsForHuman).toBeUndefined();
		const blocked = applyAll(RUN, working, [
			moved(NOTES, "in_progress", "blocked"),
		]);
		expect(blocked.tasks[0]).toMatchObject({
			status: "blocked",
			waitsForHuman: true,
		});
		// The human's instruction unblocks it: the answer, then the task going back to work.
		const again = applyAll(RUN, blocked, [
			event(
				"approval.resolved",
				{
					approver: "human",
					decision: "revise",
					feedback: "install the tool",
				},
				NOTES,
			),
			moved(NOTES, "blocked", "in_progress"),
		]);
		expect(again.tasks[0]?.waitsForHuman).toBeUndefined();
		expect(again.tasks[0]?.status).toBe("in_progress");
		expect(blocked.tasks[0]?.keptSubmission).toBeUndefined();
	});

	it("marks a task blocked from its submission, by its revision limit, as keeping that submission (ADR-157)", () => {
		const limited = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			moved(NOTES, "in_progress", "submitted"),
			moved(NOTES, "submitted", "blocked"),
		]);
		expect(limited.tasks[0]).toMatchObject({
			status: "blocked",
			waitsForHuman: true,
			keptSubmission: true,
		});
		const accepted = applyAll(RUN, limited, [
			moved(NOTES, "blocked", "approved"),
		]);
		expect(accepted.tasks[0]?.status).toBe("approved");
		expect(accepted.tasks[0]?.keptSubmission).toBeUndefined();
		expect(accepted.tasks[0]?.waitsForHuman).toBeUndefined();
	});

	it("marks an approved task whose merge failed as waiting for the human, with git's cause and the files in the way (ADR-156)", () => {
		const approved = [
			created(NOTES, "Take notes"),
			moved(NOTES, "submitted", "approved"),
		];
		const failed = (payload: object) =>
			applyAll(RUN, EMPTY_TEAM_VIEW, [
				...approved,
				event("task.merge.failed", payload, NOTES),
			]).tasks[0];
		const branch = `mete/${RUN}/${NOTES}`;
		expect(
			failed({
				code: "merge_conflict",
				message: "merging README.md conflicts with the workspace",
				branch,
				paths: ["README.md"],
			}),
		).toMatchObject({
			status: "approved",
			waitsForHuman: true,
			merge: {
				message: "merging README.md conflicts with the workspace",
				paths: ["README.md"],
			},
		});
		// An io failure names no files.
		const io = failed({ code: "io", message: "git merge failed", branch });
		expect(io?.merge).toEqual({ message: "git merge failed" });
		expect(io?.waitsForHuman).toBe(true);
	});

	it("clears a failed merge when the run resumes to try it again, marks a retry that fails, and keeps another task's wait (ADR-156)", () => {
		const conflict = {
			code: "merge_conflict",
			message: "merging README.md conflicts with the workspace",
			branch: `mete/${RUN}/${NOTES}`,
			paths: ["README.md"],
		};
		const failed = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			created(SUMMARY, "Summarize"),
			moved(NOTES, "submitted", "approved"),
			event("task.merge.failed", conflict, NOTES),
			event("approval.requested", { approver: "human" }, SUMMARY),
			event("run.paused", { reason: "approval" }),
		]);
		// Try the merge again: the human's approval, then the run resumes.
		const resumed = applyAll(RUN, failed, [
			event(
				"approval.resolved",
				{ approver: "human", decision: "approve" },
				NOTES,
			),
			event("run.resumed", {}),
		]);
		expect(resumed.tasks[0]?.merge).toBeUndefined();
		expect(resumed.tasks[0]?.waitsForHuman).toBeUndefined();
		expect(resumed.tasks[1]?.waitsForHuman).toBe(true);
		// Resume alone tries the merge again too, with no approval event.
		const bare = applyAll(RUN, failed, [event("run.resumed", {})]);
		expect(bare.tasks[0]?.merge).toBeUndefined();
		expect(bare.tasks[0]?.waitsForHuman).toBeUndefined();
		const again = applyAll(RUN, bare, [
			event("task.merge.failed", conflict, NOTES),
		]);
		expect(again.tasks[0]).toMatchObject({
			waitsForHuman: true,
			merge: { paths: ["README.md"] },
		});
	});

	it("keeps each task's latest artifact path", () => {
		const art = (type: string, path: string) =>
			event(
				type,
				{ artifactId: crypto.randomUUID(), type: "code-change@1", path },
				NOTES,
			);
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created(NOTES, "Take notes"),
			art("artifact.created", ".mete/artifacts/r/notes.md"),
			art("artifact.updated", ".mete/artifacts/r/notes-2.md"),
		]);
		expect(view.tasks[0]?.artifactPath).toBe(".mete/artifacts/r/notes-2.md");
	});

	it("lists the run's checkpoints by number and time, and marks one when it is restored (ADR-079)", () => {
		const ref = (n: number) => `refs/mete/checkpoints/${RUN}/${n}`;
		const first = event("checkpoint.created", { kind: "git", ref: ref(1) });
		const undo = event("checkpoint.created", { kind: "git", ref: ref(2) });
		const back = event("rollback.performed", { checkpointId: first.id });
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [first, undo, back, back]);
		expect(view.checkpoints).toEqual([
			{ id: first.id, ref: ref(1), n: 1, at: first.ts, restoredAt: back.ts },
			{ id: undo.id, ref: ref(2), n: 2, at: undo.ts },
		]);
		// A file snapshot (ADR-080) ends in its number too.
		const snap = event("checkpoint.created", {
			kind: "snapshot",
			ref: `snapshots/${RUN}/3`,
		});
		expect(applyEvent(RUN, view, snap).checkpoints.at(-1)?.n).toBe(3);
		const other = event(
			"checkpoint.created",
			{ kind: "git", ref: "refs/mete/checkpoints/x/1" },
			undefined,
			crypto.randomUUID(),
		);
		expect(applyEvent(RUN, view, other).checkpoints).toBe(view.checkpoints);
	});

	it("keeps the view unchanged by events it does not draw", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [created(NOTES, "Take notes")]);
		const next = applyEvent(RUN, view, event("agent.thinking.started", {}));
		expect(next.tasks).toBe(view.tasks);
	});

	it("puts each status in the Board column of ADR-051, with its marker", () => {
		expect(placeOf("todo")).toEqual({ column: "todo" });
		expect(placeOf("in_progress")).toEqual({ column: "in_progress" });
		expect(placeOf("submitted")).toEqual({
			column: "in_progress",
			marker: "in_review",
		});
		expect(placeOf("changes_requested")).toEqual({
			column: "in_progress",
			marker: "changes_asked",
		});
		expect(placeOf("blocked")).toEqual({
			column: "in_progress",
			marker: "blocked",
		});
		expect(placeOf("approved")).toEqual({ column: "done" });
	});

	it("puts an approved task whose merge failed in Done, marked Not merged (ADR-156)", () => {
		const task = {
			id: NOTES,
			title: "Take notes",
			roleId: "writer",
			dependsOn: [],
			status: "approved",
		} as const;
		expect(placeOfTask(task)).toEqual({ column: "done" });
		expect(
			placeOfTask({ ...task, merge: { message: "git merge failed" } }),
		).toEqual({
			column: "done",
			marker: "not_merged",
		});
	});
});
