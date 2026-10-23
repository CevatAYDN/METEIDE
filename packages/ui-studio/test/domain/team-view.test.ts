import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	applyAll,
	applyEvent,
	EMPTY_TEAM_VIEW,
	placeOf,
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
});
