import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	type BoardModel,
	BoardView,
	type TeamMode,
} from "../src/application/board-view.js";

// The Board rendered to HTML on Node from a view the real fold built.

const RUN = crypto.randomUUID();
const html = (model: BoardModel, mode: TeamMode = "board") =>
	renderToStaticMarkup(
		createElement(BoardView, {
			model,
			controls: {
				mode,
				onMode: () => {},
				flow: (v) => `flow of ${v.tasks.length} task(s)`,
				studio: (v) => `studio of ${v.tasks.length} task(s)`,
			},
		}),
	);

const event = (type: string, payload: object, taskId: string): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-23T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		taskId,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const task = (title: string) => {
	const id = crypto.randomUUID();
	return {
		id,
		created: event(
			"task.created",
			{ title, roleId: "writer", dependsOn: [] },
			id,
		),
		to: (from: string, to: string) =>
			event("task.status.changed", { from, to }, id),
	};
};

const section = (out: string, name: string) => {
	const at = out.indexOf(`aria-label="${name}"`);
	return out.slice(at, out.indexOf("</section>", at));
};

describe("the Board view", () => {
	it("puts each task in its column, with the marker of its status", () => {
		const notes = task("Take <notes>");
		const draft = task("Draft");
		const fix = task("Fix");
		const done = task("Ship");
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			notes.created,
			draft.created,
			fix.created,
			done.created,
			draft.to("in_progress", "submitted"),
			fix.to("submitted", "changes_requested"),
			done.to("submitted", "approved"),
		]);
		const out = html({
			kind: "board",
			goal: "a goal",
			view,
			unreadable: 0,
			recent: [],
		});
		expect(section(out, "To do")).toContain("Take &lt;notes&gt;");
		const doing = section(out, "In progress");
		expect(doing).toContain("Draft");
		expect(doing).toContain("writer · In review");
		expect(doing).toContain("writer · Changes asked");
		expect(section(out, "Done")).toContain("Ship");
		expect(out).toContain("a goal");
		expect(out).not.toContain("could not be read");
	});

	it("switches between the Board and the Flow graph of the same view", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [task("Notes").created]);
		const model: BoardModel = {
			kind: "board",
			goal: "g",
			view,
			unreadable: 0,
			recent: [],
		};
		const board = html(model);
		expect(board).toContain('aria-pressed="true">Board<');
		expect(board).toContain('aria-label="To do"');
		const flow = html(model, "flow");
		expect(flow).toContain('aria-pressed="true">Flow<');
		expect(flow).toContain("flow of 1 task(s)");
		expect(flow).not.toContain('aria-label="To do"');
	});

	it("draws the Studio with a list of the latest events, each with its task", () => {
		const notes = task("Notes");
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [notes.created]);
		const out = html(
			{
				kind: "board",
				goal: "g",
				view,
				unreadable: 0,
				recent: [notes.created],
			},
			"studio",
		);
		expect(out).toContain('aria-pressed="true">Studio<');
		expect(out).toContain("studio of 1 task(s)");
		const list = out.slice(out.indexOf('aria-label="Latest events"'));
		expect(list).toContain("task.created · Notes");
		expect(
			html({ kind: "board", goal: "g", view, unreadable: 0, recent: [] }),
		).not.toContain("Latest events");
	});

	it("offers the Studio for a single-agent run, which has no board", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			{
				...task("x").created,
				taskId: undefined,
				type: "agent.created",
				agentId: crypto.randomUUID(),
				payload: { roleId: "agent", providerId: "groq", modelId: "m" },
			} as MeteEvent,
		]);
		const model: BoardModel = {
			kind: "board",
			goal: "g",
			view,
			unreadable: 0,
			recent: [],
		};
		expect(html(model)).toContain("a single agent works without a board");
		expect(html(model)).toContain(">Studio<");
		expect(html(model, "studio")).toContain("studio of 0 task(s)");
	});

	it("says how many events could not be read, and that a single agent has no board", () => {
		const out = html({
			kind: "board",
			goal: "g",
			view: EMPTY_TEAM_VIEW,
			unreadable: 2,
			recent: [],
		});
		expect(out).toContain("2 event(s) of this run could not be read");
		expect(out).toContain("a single agent works without a board");
		expect(out).not.toContain('aria-label="To do"');
	});

	it("asks for a run, says it is reading, or shows why it failed", () => {
		expect(html({ kind: "no_run" })).toContain("METE: Open team panel");
		expect(html({ kind: "loading" })).toContain("Reading the run");
		const failed = html({
			kind: "failed",
			failure: { code: "refused", detail: "run not found" },
		});
		expect(failed).toContain('role="alert"');
		expect(failed).toContain("run not found");
	});
});
