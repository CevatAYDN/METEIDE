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
import { restoredText } from "../src/application/checkpoint-list.js";

// The Board rendered to HTML on Node from a view the real fold built.

const RUN = crypto.randomUUID();
const html = (
	model: BoardModel,
	mode: TeamMode = "board",
	restoring?: string,
) =>
	renderToStaticMarkup(
		createElement(BoardView, {
			model,
			controls: {
				mode,
				onMode: () => {},
				flow: (v) => `flow of ${v.tasks.length} task(s)`,
				studio: (v) => `studio of ${v.tasks.length} task(s)`,
				restore: { onRestore: () => {}, restoring },
				onOpenReport: () => {},
				names: { writer: "Copy writer" },
				windows: {},
			},
		}),
	);
// The pressed mode button: its codicon, then its name.
const pressed = (name: string) =>
	new RegExp(`aria-pressed="true"><span[^>]*></span>${name}<`);

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
	it("lists the run's reports as Results with Open, and a Done card opens its report (ADR-085)", () => {
		const gdd = task("Write the design");
		const notes = task("Draft the notes");
		const plain = task("Skeleton");
		const report = (t: ReturnType<typeof task>, path: string) =>
			event(
				"artifact.created",
				{ artifactId: crypto.randomUUID(), type: "report@1", path },
				t.id,
			);
		const board = (events: MeteEvent[]): BoardModel => ({
			kind: "board",
			goal: "a game",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, events),
			unreadable: 0,
			recent: [],
		});
		const out = html(
			board([
				gdd.created,
				notes.created,
				plain.created,
				report(gdd, ".mete/artifacts/r/write_gdd.json"),
				gdd.to("submitted", "approved"),
				report(notes, ".mete/artifacts/r/notes.md"),
				notes.to("in_progress", "submitted"),
				plain.to("submitted", "approved"),
			]),
		);
		const results = section(out, "Results");
		expect(results).toContain('title=".mete/artifacts/r/write_gdd.json"');
		expect(results).toContain(">write_gdd.json<");
		expect(results).toContain(
			'aria-label="Open the report of Draft the notes"',
		);
		expect(results).not.toContain("Skeleton");
		// Results come before the view switch.
		expect(out.indexOf('aria-label="Results"')).toBeLessThan(
			out.indexOf(">Board<"),
		);
		const done = section(out, "Done");
		expect(done.match(/>Open report</g)).toHaveLength(1);
		expect(done).toContain('aria-label="Open the report of Write the design"');
		expect(section(out, "In progress")).not.toContain("Open report");
		expect(html(board([plain.created]))).not.toContain('aria-label="Results"');
	});

	it("lists the run's checkpoints newest first with Restore, a restored one marked, and none without checkpoints (ADR-079)", () => {
		const cp = (n: number) =>
			event(
				"checkpoint.created",
				{ kind: "git", ref: `refs/mete/checkpoints/${RUN}/${n}` },
				"",
			);
		const [one, two] = [cp(1), cp(2)];
		const back = event("rollback.performed", { checkpointId: one.id }, "");
		const board = (events: MeteEvent[]): BoardModel => ({
			kind: "board",
			goal: "fix it",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, events),
			unreadable: 0,
			recent: [],
		});
		const out = html(board([one, two, back]));
		const list = section(out, "Checkpoints");
		expect(list.indexOf("#2 · ")).toBeLessThan(list.indexOf("#1 · "));
		expect(list.match(/>Restore</g)).toHaveLength(2);
		expect(list.slice(list.indexOf("#1 · "))).toContain("restored ");
		expect(list.slice(0, list.indexOf("#1 · "))).not.toContain("restored ");
		const busy = section(
			html(board([one, two]), "board", one.id),
			"Checkpoints",
		);
		expect(busy).toContain(">Restoring…<");
		expect(busy.match(/disabled=""/g)).toHaveLength(2);
		expect(html(board([]))).not.toContain('aria-label="Checkpoints"');
		expect(
			restoredText({
				ref: `refs/mete/checkpoints/${RUN}/1`,
				undo: `refs/mete/checkpoints/${RUN}/3`,
			}),
		).toBe("Restored checkpoint #1; checkpoint #3 undoes it.");
	});

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
		expect(board).toMatch(pressed("Board"));
		expect(board).toContain('aria-label="To do"');
		const flow = html(model, "flow");
		expect(flow).toMatch(pressed("Flow"));
		expect(flow).toContain("flow of 1 task(s)");
		expect(flow).not.toContain('aria-label="To do"');
	});

	it("lists the run's members in the Team view, named as the team file names them (ADR-089)", () => {
		const notes = task("Notes");
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [notes.created]);
		const out = html(
			{ kind: "board", goal: "g", view, unreadable: 0, recent: [] },
			"team",
		);
		expect(out).toMatch(pressed("Team"));
		expect(out).toContain('aria-label="Copy writer"');
		expect(out).toContain(
			"Members: 1 · working: 0 · waiting for you: 0 · done: 0",
		);
		expect(out).toContain("0 of 1 tasks done");
		expect(out).toContain("codicon-circle-outline");
		expect(out).not.toContain('aria-label="To do"');
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
		expect(out).toMatch(pressed("Studio"));
		expect(out).toContain("studio of 1 task(s)");
		const list = out.slice(out.indexOf('aria-label="Latest events"'));
		expect(list).toContain("A note for Notes drops into To do.");
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
		expect(html(model, "flow")).toContain(
			"a single agent works without a board",
		);
		expect(html(model, "flow")).not.toContain("flow of");
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

	it("says it is reading, or shows why it failed; with no run the widget shows the composer (ADR-078)", () => {
		expect(html({ kind: "no_run" })).not.toContain("<p>");
		expect(html({ kind: "loading" })).toContain("Reading the run");
		const failed = html({
			kind: "failed",
			failure: { code: "refused", detail: "run not found" },
		});
		expect(failed).toContain('role="alert"');
		expect(failed).toContain("run not found");
	});
});
