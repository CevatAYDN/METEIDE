import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	IDLE_BOARD,
	loadedBoard,
	receiveBoard,
	startBoard,
} from "../src/application/board-session.js";

// The Board's ordering of history and live events, without a widget.

const RUN = crypto.randomUUID();
const TASK = crypto.randomUUID();
const shown = { dir: "/w", runId: RUN, goal: "g" };

const event = (type: string, payload: object, runId = RUN): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-23T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId,
		taskId: TASK,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const created = event("task.created", {
	title: "Notes",
	roleId: "writer",
	dependsOn: [],
});
const started = event("task.status.changed", {
	from: "todo",
	to: "in_progress",
});
const ok = (events: MeteEvent[], unreadable = 0) =>
	({ ok: true, value: { events, unreadable } }) as const;

describe("the Board session", () => {
	it("applies a live event that came before the history after it, so no change is lost", () => {
		const s = receiveBoard(startBoard(shown), "/w", started);
		expect(s.model).toEqual({ kind: "loading" });
		const done = loadedBoard(s, shown, ok([created], 1));
		expect(done.model).toMatchObject({
			kind: "board",
			goal: "g",
			unreadable: 1,
		});
		expect(done.view.tasks.map((t) => t.status)).toEqual(["in_progress"]);
		expect(done.buffer).toBeUndefined();
	});

	it("ignores the history of a run that is no longer shown", () => {
		const first = startBoard(shown);
		const second = startBoard({ ...shown, runId: crypto.randomUUID() });
		expect(loadedBoard(second, first.shown ?? shown, ok([created]))).toBe(
			second,
		);
	});

	it("passes the workspace's quota events, which name no run, to the fold", () => {
		const s = loadedBoard(startBoard(shown), shown, ok([created]));
		const resetsAt = "2026-10-24T00:00:00.000Z";
		const { runId: _, ...quota } = event("quota.exhausted", {
			providerId: "groq",
			unit: "requests_per_day",
			resetsAt,
		}) as MeteEvent & { runId?: string };
		const next = receiveBoard(s, "/w", quota as MeteEvent);
		expect(next.view.signals.exhausted).toEqual({ groq: resetsAt });
	});

	it("keeps the run's latest studio events, once each, history first", () => {
		const s = loadedBoard(startBoard(shown), shown, ok([created]));
		const next = receiveBoard(s, "/w", started);
		expect(next.recent.map((e) => e.type)).toEqual([
			"task.created",
			"task.status.changed",
		]);
		expect(receiveBoard(next, "/w", started).recent).toBe(next.recent);
		expect(next.model).toMatchObject({ recent: next.recent });
	});

	it("stays failed when live events come after a failed read", () => {
		const s = loadedBoard(startBoard(shown), shown, {
			ok: false,
			error: { code: "stopped", detail: "exit code 1" },
		});
		expect(s.model.kind).toBe("failed");
		expect(receiveBoard(s, "/w", created).model.kind).toBe("failed");
	});

	it("draws a live event once and ignores what the history had, other runs and other folders", () => {
		const s = loadedBoard(startBoard(shown), shown, ok([created]));
		expect(receiveBoard(s, "/w", created)).toBe(s);
		expect(receiveBoard(s, "/other", started)).toBe(s);
		expect(
			receiveBoard(s, "/w", event("task.created", {}, crypto.randomUUID())),
		).toBe(s);
		const next = receiveBoard(s, "/w", started);
		expect(next.model).toMatchObject({ kind: "board" });
		expect(next.view.tasks[0]?.status).toBe("in_progress");
		expect(receiveBoard(IDLE_BOARD, "/w", started)).toBe(IDLE_BOARD);
	});
});
