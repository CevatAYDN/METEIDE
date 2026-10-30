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
import type { RunFacts } from "../src/application/run-hero.js";
import { stepTab } from "../src/application/tab-list.js";

// The Board rendered to HTML on Node from a view the real fold built.

const RUN = crypto.randomUUID();
const html = (
	model: BoardModel,
	mode: TeamMode = "board",
	restoring?: string,
	run: RunFacts = {},
) =>
	renderToStaticMarkup(
		createElement(BoardView, {
			model,
			controls: {
				mode,
				onMode: () => {},
				flow: (v) => `flow of ${v.tasks.length} task(s)`,
				studio: (v) => `studio of ${v.tasks.length} task(s)`,
				markdown: {
					render: () => {
						throw new Error("markdown is drawn in the browser");
					},
				},
				restore: { onRestore: () => {}, restoring },
				onOpenReport: () => {},
				names: { writer: "Copy writer" },
				windows: {},
				transcript: {},
				run,
				waiting: {
					onApprove: () => {},
					onRevise: () => {},
					onResume: () => {},
					onShowFiles: () => {},
				},
			},
		}),
	);
// The selected view tab: its codicon, then its name.
const pressed = (name: string) =>
	new RegExp(`aria-selected="true"[^>]*><span[^>]*></span>${name}<`);

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

// A run as `mete/status` answers it, for the strip and the model choice (ADR-094, ADR-122).
const runEntry = (status: "running" | "completed") => ({
	id: RUN,
	workspaceId: crypto.randomUUID(),
	templateId: "team",
	goal: "g",
	status,
	autonomyLevel: 1 as const,
	budget: { cloudRequests: 0, maxHours: 1 },
	createdAt: "2026-10-23T10:00:00.000Z",
});

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
	it("shows the hero band in every view, the status over the goal, once the daemon has answered (ADR-094, ADR-127)", () => {
		const model: BoardModel = {
			kind: "board",
			goal: "Build a page",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, [
				event(
					"task.created",
					{ title: "Write it", roleId: "writer", dependsOn: [] },
					"t1",
				),
			]),
			unreadable: 0,
			recent: [],
			feed: [],
		};
		const facts: RunFacts = {
			run: {
				id: RUN,
				workspaceId: "w",
				templateId: null,
				goal: "Build a page",
				status: "paused",
				autonomyLevel: 1,
				budget: { cloudRequests: 12, maxHours: 2 },
				createdAt: "2026-10-24T15:00:00",
			},
		};
		for (const mode of ["board", "flow", "studio", "team"] as const) {
			const out = html(model, mode, undefined, facts);
			expect(out).toContain("Paused");
			expect(out).toContain("up to 12 requests, 2 h");
			expect(out.indexOf("Paused")).toBeLessThan(out.indexOf("Build a page"));
		}
		expect(html(model)).not.toContain("up to 12 requests");
	});

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
			feed: [],
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
		// Results are the rail's Artifacts tab, after the view switch and the view (ADR-119).
		expect(out.indexOf('aria-label="Results"')).toBeGreaterThan(
			out.indexOf('aria-label="Run details"'),
		);
		expect(out.indexOf('aria-label="Run details"')).toBeGreaterThan(
			out.indexOf(">Board<"),
		);
		expect(out).toMatch(
			/data-tab="artifacts"[^>]*>.*?<span class="mete-count">2</,
		);
		const done = section(out, "Done");
		expect(done.match(/>Open report</g)).toHaveLength(1);
		expect(done).toContain('aria-label="Open the report of Write the design"');
		expect(section(out, "In progress")).not.toContain("Open report");
		expect(html(board([plain.created]))).not.toContain('aria-label="Results"');
	});

	it("puts the feed and the reports in the rail beside every view, opening on the reports once the run is finished (ADR-119)", () => {
		const doc = task("Write the notes");
		const created = event(
			"artifact.created",
			{ artifactId: crypto.randomUUID(), type: "report@1", path: "n.md" },
			doc.id,
		);
		const model = (events: MeteEvent[]): BoardModel => ({
			kind: "board",
			goal: "g",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, events),
			unreadable: 0,
			recent: [],
			feed: events,
		});
		const facts = (status: "running" | "completed"): RunFacts => ({
			run: {
				id: RUN,
				workspaceId: "w",
				templateId: null,
				goal: "g",
				status,
				autonomyLevel: 1,
				budget: { cloudRequests: 12, maxHours: 2 },
				createdAt: "2026-10-24T15:00:00",
			},
		});
		// The rail follows the center, whose view switch has tabs of its own.
		const rail = (out: string) =>
			out.slice(out.indexOf('aria-label="Run details"'));
		const selected = (out: string) =>
			/data-tab="(\w+)" aria-selected="true"/.exec(rail(out))?.[1];
		const withReport = model([doc.created, created]);
		for (const mode of ["board", "flow", "studio", "team"] as const) {
			const out = html(withReport, mode, undefined, facts("running"));
			expect(out.split("Activity · newest first")).toHaveLength(2);
			expect(rail(out).match(/role="tabpanel"/g)).toHaveLength(3);
			expect(rail(out).match(/role="tabpanel"[^>]*hidden=""/g)).toHaveLength(2);
			expect(selected(out)).toBe("activity");
		}
		expect(
			selected(html(withReport, "board", undefined, facts("completed"))),
		).toBe("artifacts");
		const noReport = html(
			model([doc.created]),
			"board",
			undefined,
			facts("completed"),
		);
		expect(selected(noReport)).toBe("activity");
		expect(noReport).toContain("No reports yet");
	});

	it("lists the files a completed run changed under its reports, and opens on them (ADR-133)", () => {
		const page = task("Write the page");
		const handoff = event(
			"handoff.created",
			{
				handoffId: crypto.randomUUID(),
				files: ["index.html", "design/DESIGN.md"],
			},
			page.id,
		);
		const model: BoardModel = {
			kind: "board",
			goal: "g",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, [page.created, handoff]),
			unreadable: 0,
			recent: [],
			feed: [],
		};
		const facts = (status: "paused" | "completed" | "failed"): RunFacts => ({
			run: { ...runEntry("completed"), status },
		});
		const done = html(model, "board", undefined, facts("completed"));
		const files = section(done, "Files");
		expect(files).toContain('aria-label="Open index.html"');
		expect(files).toContain('aria-label="Open design/DESIGN.md"');
		expect(done).not.toContain("No reports yet");
		expect(done).toMatch(
			/data-tab="artifacts" aria-selected="true"[^>]*>.*?<span class="mete-count">2</,
		);
		// A paused or failed run's files wait in a worktree, not in the folder.
		for (const status of ["paused", "failed"] as const)
			expect(html(model, "board", undefined, facts(status))).not.toContain(
				'aria-label="Files"',
			);
	});

	const RAIL = ["activity", "artifacts", "tasks"] as const;

	it("moves between tabs with the arrow keys, Home and End, wrapping at the ends", () => {
		expect(stepTab(RAIL, "activity", "ArrowRight")).toBe("artifacts");
		expect(stepTab(RAIL, "tasks", "ArrowRight")).toBe("activity");
		expect(stepTab(RAIL, "activity", "ArrowLeft")).toBe("tasks");
		expect(stepTab(RAIL, "tasks", "Home")).toBe("activity");
		expect(stepTab(RAIL, "activity", "End")).toBe("tasks");
		expect(stepTab(RAIL, "activity", "Enter")).toBeUndefined();
	});

	it("lists every task in the rail's Tasks tab with where it stands and its member, in the Board's words (ADR-119)", () => {
		const notes = task("Take notes");
		const summary = task("Write the summary");
		const out = html({
			kind: "board",
			goal: "g",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, [
				notes.created,
				summary.created,
				notes.to("in_progress", "blocked"),
			]),
			unreadable: 0,
			recent: [],
			feed: [],
		});
		const tasks = out.slice(out.indexOf('data-tab="tasks"'));
		// The tab counts the approved tasks of all (ADR-127).
		expect(tasks).toContain('Tasks<span class="mete-count">0/2</span>');
		expect(tasks).toContain("Blocked · Copy writer");
		expect(tasks).toContain("To do · Copy writer");
		expect(tasks.indexOf("Take notes")).toBeLessThan(
			tasks.indexOf("Write the summary"),
		);
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
			feed: [],
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
			feed: [],
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

	it("marks a task whose merge did not land Not merged in Done, on the Board and in the Tasks tab (ADR-156)", () => {
		const ship = task("Ship");
		const out = html({
			kind: "board",
			goal: "g",
			view: applyAll(RUN, EMPTY_TEAM_VIEW, [
				ship.created,
				ship.to("submitted", "approved"),
				event(
					"task.merge.failed",
					{ code: "io", message: "git merge failed", branch: "mete/r/t" },
					ship.id,
				),
			]),
			unreadable: 0,
			recent: [],
			feed: [],
		});
		expect(section(out, "Done")).toContain("writer · Not merged");
		const tasks = out.slice(out.indexOf('data-tab="tasks"'));
		expect(tasks).toContain("Not merged · Copy writer");
	});

	it("switches between the Board and the Flow graph of the same view", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [task("Notes").created]);
		const model: BoardModel = {
			kind: "board",
			goal: "g",
			view,
			unreadable: 0,
			recent: [],
			feed: [],
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
			{ kind: "board", goal: "g", view, unreadable: 0, recent: [], feed: [] },
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

	// The Team view of a one-task run, with the model choice the panel passes (ADR-122).
	const teamMarkup = (run: RunFacts) => {
		const notes = task("Notes");
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [notes.created]);
		return renderToStaticMarkup(
			createElement(BoardView, {
				model: {
					kind: "board",
					goal: "g",
					view,
					unreadable: 0,
					recent: [],
					feed: [],
				},
				controls: {
					mode: "team",
					onMode: () => {},
					flow: () => null,
					studio: () => null,
					markdown: {
						render: () => {
							throw new Error("markdown is drawn in the browser");
						},
					},
					restore: { onRestore: () => {} },
					onOpenReport: () => {},
					names: { writer: "Copy writer" },
					windows: {},
					transcript: {},
					run,
					onModel: () => {},
					candidateModels: { writer: ["groq/llama-3.3-70b"] },
					preferredModels: { writer: "groq/llama-3.3-70b" },
					waiting: {
						onApprove: () => {},
						onRevise: () => {},
						onResume: () => {},
						onShowFiles: () => {},
					},
				},
			}),
		);
	};

	it("passes candidateModels and onModel to the Team view while the run can still be steered (ADR-122)", () => {
		const out = teamMarkup({ run: runEntry("running") });
		expect(out).toContain("Preferred model (optional)");
		expect(out).toContain('value="groq/llama-3.3-70b"');
		expect(out).toContain('<span class="mete-picker-id">llama-3.3-70b</span>');
		expect(out).toContain("Revert to default");
	});

	it("hides the model choice once the run has ended (ADR-122)", () => {
		const out = teamMarkup({ run: runEntry("completed") });
		expect(out).toContain("Copy writer");
		expect(out).not.toContain("Preferred model (optional)");
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
				feed: [],
			},
			"studio",
		);
		expect(out).toMatch(pressed("Studio"));
		expect(out).toContain("studio of 1 task(s)");
		const list = out.slice(out.indexOf('aria-label="Latest events"'));
		expect(list).toContain("A note for Notes drops into To do.");
		expect(
			html({
				kind: "board",
				goal: "g",
				view,
				unreadable: 0,
				recent: [],
				feed: [],
			}),
		).not.toContain("Latest events");
	});

	it("offers Steps, the Studio and the Team for a single-agent run, which has no board or graph (ADR-127)", () => {
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
			feed: [],
		};
		expect(html(model)).toContain("a single agent works without a board");
		expect(html(model)).toContain(">Studio<");
		expect(html(model)).toMatch(pressed("Steps"));
		expect(html(model)).not.toContain(">Flow<");
		expect(html(model, "studio")).toContain("studio of 0 task(s)");
		expect(html(model, "flow")).toContain(
			"a single agent works without a board",
		);
		expect(html(model, "flow")).not.toContain("flow of");
	});

	it("leads the center with a finished single-agent run's answer, in place of the empty-board note (ADR-127)", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			{
				...task("x").created,
				taskId: undefined,
				type: "agent.created",
				agentId: crypto.randomUUID(),
				payload: { roleId: "agent", providerId: "groq", modelId: "m" },
			} as MeteEvent,
		]);
		const base: BoardModel = {
			kind: "board",
			goal: "g",
			view,
			unreadable: 0,
			recent: [],
			feed: [],
		};
		const out = html({ ...base, answer: "# Done\n\nTwo files changed." });
		expect(out).toContain('aria-label="Answer"');
		expect(out).toContain(">Answer<");
		// Once it has ended the answer leads the center, above the view switch (ADR-127).
		expect(out.indexOf('aria-label="Answer"')).toBeLessThan(
			out.indexOf('role="tablist"'),
		);
		expect(html({ ...base, answer: "Done" }, "studio")).toContain(
			'aria-label="Answer"',
		);
		const center = (page: string) =>
			page.slice(0, page.indexOf('class="mete-run-rail"'));
		expect(center(out)).not.toContain("single agent works without a board");
		expect(center(html(base))).toContain("single agent works without a board");
		// A failed one leads with its failure instead, as an alert of its own (ADR-128).
		const failed = html({
			...base,
			runFailed: { code: "bad_request", message: "groq answered 400" },
		});
		expect(failed).toMatch(
			/role="alert"[\s\S]*?The run fails: <code>bad_request<\/code>\.[\s\S]*?groq answered 400/,
		);
		expect(failed.indexOf('class="mete-failure"')).toBeLessThan(
			failed.indexOf('role="tablist"'),
		);
		expect(failed).not.toContain('aria-label="Answer"');
	});

	it("says how many events could not be read, and that a single agent has no board", () => {
		const out = html({
			kind: "board",
			goal: "g",
			view: EMPTY_TEAM_VIEW,
			unreadable: 2,
			recent: [],
			feed: [],
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
