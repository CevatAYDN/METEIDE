import { EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	QuotaSection,
	RunsSection,
	WaitingSection,
} from "../src/application/home-view.js";
import { heroOf } from "../src/application/run-hero.js";
import { shortWhen } from "../src/application/time-text.js";
import {
	parentTail,
	type Workspace,
	WorkspacesSection,
} from "../src/application/workspaces-section.js";
import {
	activeRunsOf,
	type HomeModel,
	homeModel,
	runsHere,
	waitingCount,
} from "../src/domain/home-model.js";
import type { StatusRuns } from "../src/domain/status-service.js";

// The METE view's sections rendered to HTML on Node, stacked in the view's order: no DOM and no
// Theia widget, only the views and their model.

const AT = "2026-10-23T10:00:00.000Z";

const none = () => {};

const html = (model: HomeModel, workspaces: readonly Workspace[] = []) =>
	renderToStaticMarkup(
		createElement(
			Fragment,
			null,
			createElement(WaitingSection, { model, onAct: none }),
			createElement(RunsSection, {
				model,
				onRefresh: none,
				onAct: none,
				onSetKey: none,
				onStart: none,
			}),
			createElement(WorkspacesSection, {
				workspaces,
				actions: { onOpen: none, onForget: none, onAdd: none },
			}),
			createElement(QuotaSection, { model, onOpenQuota: none }),
		),
	);

const RUNS = 'aria-label="Runs"';

const run = (
	status: string,
	goal: string,
	templateId: string | null,
	pauseReason?: string,
) =>
	({
		...(pauseReason ? { pauseReason } : {}),
		id: crypto.randomUUID(),
		workspaceId: crypto.randomUUID(),
		templateId,
		goal,
		status,
		autonomyLevel: 2,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: AT,
	}) as StatusRuns[number];

describe("the Home view", () => {
	it("says it is asking, or that a folder is needed, without a time", () => {
		expect(html({ kind: "loading" })).toContain("Asking the METE daemon…");
		const none = html({ kind: "no_folder" });
		expect(none).toContain(
			"Open a folder first: METE works on one folder at a time.",
		);
		expect(none).not.toContain("As of");
		expect(none).toContain(
			'<button type="button" class="mete-button quiet"><span aria-hidden="true" class="codicon codicon-refresh"></span>Refresh</button>',
		);
	});

	it("offers New run, which opens the composer, once there is a folder to run in (ADR-078)", () => {
		const start =
			'<button type="button" class="mete-button"><span aria-hidden="true" class="codicon codicon-add"></span>New run</button>';
		expect(html({ kind: "loading" })).toContain(start);
		expect(html({ kind: "no_folder" })).not.toContain(start);
	});

	it("lists the runs with a status chip, goal and template, with the time of the snapshot", () => {
		const out = html(
			homeModel(
				{
					ok: true,
					value: [
						run("paused", "fix <the> bug", "web-dev"),
						run("completed", "notes", null),
					],
				},
				AT,
			),
		);
		expect(out).toContain('<span class="mete-chip warn">Paused</span>');
		expect(out).toContain("fix &lt;the&gt; bug");
		expect(out).toContain(" · Web dev");
		expect(out).toContain('<span class="mete-chip good">Done</span>');
		// The snapshot's time is Refresh's tooltip, beside New run, above the list.
		expect(out).toMatch(
			/<button type="button" class="mete-button quiet" title="As of [^"]+"><span[^>]*><\/span>Refresh</,
		);
		expect(out.indexOf(">Refresh<")).toBeLessThan(out.indexOf("notes"));
	});

	it("turns a running row's glyph, and no other row's (ADR-128)", () => {
		const out = html(
			homeModel(
				{
					ok: true,
					value: [
						run("running", "busy", null),
						run("completed", "notes", null),
					],
				},
				AT,
			),
		);
		expect(out.match(/codicon-modifier-spin/g)).toHaveLength(1);
		expect(out).toContain("codicon-loading codicon-modifier-spin");
	});

	it("gives a run's status the same tone in the list as in the hero band (ADR-094, ADR-127)", () => {
		const statuses = [
			"queued",
			"running",
			"paused",
			"completed",
			"failed",
			"cancelled",
		] as const;
		for (const status of statuses) {
			const entry = run(status, "a goal", null);
			const pill = heroOf({ run: entry }, EMPTY_TEAM_VIEW).status;
			const out = html(homeModel({ ok: true, value: [entry] }, AT));
			expect(out).toContain(
				`<span class="mete-chip ${pill?.tone}">${pill?.word}</span>`,
			);
		}
	});

	it("shows a run of today by its hour and an older one with its day, the whole time in the tooltip", () => {
		const now = new Date(2026, 9, 24, 15, 0);
		const today = new Date(2026, 9, 24, 9, 5).toISOString();
		const older = new Date(2026, 9, 3, 9, 5).toISOString();
		expect(shortWhen(today, now)).not.toContain("24");
		expect(shortWhen(today, now)).toMatch(/09.05/);
		expect(shortWhen(older, now)).toContain("3");
		expect(shortWhen(older, now)).toMatch(/09.05/);
		const out = html(
			homeModel({ ok: true, value: [run("completed", "notes", null)] }, AT),
		);
		// No seconds in the list.
		expect(out).not.toMatch(/:\d\d:\d\d</);
	});

	it("counts the runs that wait for you for the inbox badge, and none without runs", () => {
		const model = homeModel(
			{
				ok: true,
				value: [
					run("paused", "a", "web-dev", "approval"),
					run("paused", "b", "web-dev", "quota"),
					run("paused", "c", "web-dev", "approval"),
					run("running", "d", null),
				],
			},
			AT,
		);
		expect(waitingCount(model)).toBe(2);
		expect(waitingCount({ kind: "loading" })).toBe(0);
	});

	it("says there are no runs yet", () => {
		expect(html(homeModel({ ok: true, value: [] }, AT))).toContain(
			"No runs in this folder yet.",
		);
	});

	it("shows why there are none as an alert, with outside text as it is", () => {
		const out = html(
			homeModel(
				{
					ok: false,
					error: {
						code: "stopped",
						detail: String.raw`exit code 1: delete C:\w\.mete\cache\run.lock`,
					},
				},
				AT,
			),
		);
		expect(out).toContain('role="alert"');
		expect(out).toContain(
			String.raw`The METE daemon stopped: exit code 1: delete C:\w\.mete\cache\run.lock`,
		);
		const notReady = html(
			homeModel(
				{ ok: false, error: { code: "not_ready", detail: "no key" } },
				AT,
			),
		);
		expect(notReady).toContain("METE is not ready yet: no key");
	});

	it("lists the runs that wait for you above the runs, with the answers each can take", () => {
		const out = html(
			homeModel(
				{
					ok: true,
					value: [
						run("paused", "team goal", "duo", "approval"),
						run("paused", "single goal", null, "approval"),
						run("paused", "quota goal", null, "quota"),
					],
				},
				AT,
			),
		);
		expect(out.indexOf("Waiting for you")).toBeLessThan(out.indexOf(RUNS));
		const inbox = out.slice(out.indexOf("Waiting for you"), out.indexOf(RUNS));
		expect(inbox).toContain("team goal");
		expect(inbox).toContain("single goal");
		expect(inbox).not.toContain("quota goal");
		expect(inbox).toContain('title="Open in the team panel"');
		expect(inbox.match(/>Approve</g)).toHaveLength(1);
		expect(inbox.match(/>Revise…</g)).toHaveLength(1);
		expect(inbox.match(/>Open artifact</g)).toHaveLength(1);
		expect(inbox.match(/>Resume</g)).toHaveLength(2);
		expect(inbox).toContain("Open the run to answer.");
		// A long goal ends in an ellipsis, so the row's tooltip keeps it whole (ADR-109).
		expect(inbox).toContain('class="mete-title" title="team goal"');
		// The hint explains that answering happens in the run, so it wraps instead of being cut.
		expect(inbox).toContain('class="mete-note"');
	});

	it("says under a run paused for quota why each provider cannot carry it on, and only there", () => {
		const out = html(
			homeModel(
				{
					ok: true,
					value: [
						run("paused", "quota goal", null, "quota"),
						run("completed", "done goal", null),
					],
				},
				AT,
				[
					{ id: "groq", state: "ready" },
					{
						id: "openrouter",
						state: "exhausted",
						resetsAt: "2026-10-24T00:00:00.000Z",
					},
					{ id: "nvidia", state: "no_key" },
				],
			),
		);
		const quotaRow = out.slice(
			out.indexOf("quota goal"),
			out.indexOf("done goal"),
		);
		expect(quotaRow).toContain("openrouter: its free quota is used up until ");
		expect(quotaRow).toContain("nvidia: no key (METE: Set provider key)");
		// The quota chips name every provider; the runs name only those that block.
		const table = out.slice(
			out.indexOf(RUNS),
			out.indexOf('aria-label="Workspaces"'),
		);
		expect(table).not.toContain("groq");
		expect(table.slice(table.indexOf("done goal"))).not.toContain("<li style=");
		// A quota pause can be resumed before its reset (ADR-059), only there.
		expect(quotaRow).toContain(">Resume now</button>");
		expect(out.slice(out.indexOf("done goal"))).not.toContain("Resume now");
	});

	it("offers Resume under a run paused by the user, such as by a desktop quit (ADR-061)", () => {
		const out = html(
			homeModel(
				{
					ok: true,
					value: [
						run("paused", "quit goal", null, "user"),
						run("completed", "done goal", null),
					],
				},
				AT,
			),
		);
		const row = out.slice(out.indexOf("quit goal"), out.indexOf("done goal"));
		expect(row).toContain(">Resume</button>");
		expect(out.slice(out.indexOf("done goal"))).not.toContain(
			">Resume</button>",
		);
	});

	it("offers Resume under a run paused for its budget and names the budget (ADR-126)", () => {
		const out = html(
			homeModel(
				{ ok: true, value: [run("paused", "long goal", null, "budget")] },
				AT,
			),
		);
		expect(out).toContain("It used its budget: 25 model turns at a time");
		expect(out).toContain(">Resume</button>");
	});

	it("lets each run's goal open the run in the team panel", () => {
		const r = run("completed", "notes", null);
		const out = html(homeModel({ ok: true, value: [r] }, AT));
		expect(out).toContain('title="Open in the team panel"');
		expect(out).toMatch(
			/<button type="button"[^>]*title="Open in the team panel">notes<\/button>/,
		);
	});

	it("shows every provider's quota state as a chip with the whole state as its tooltip, and says when it is unknown", () => {
		const out = html(
			homeModel({ ok: true, value: [] }, AT, [
				{ id: "groq", state: "ready" },
				{ id: "nvidia", state: "no_key" },
			]),
		);
		const quota = out.slice(out.indexOf('aria-label="Quota"'));
		// Each chip's glyph tells a missing key from a used-up quota without the tooltip (ADR-128).
		expect(quota).toContain(
			'class="mete-chip good" title="groq: ready"><span aria-hidden="true" class="codicon codicon-check"></span>groq<',
		);
		expect(quota).toContain(
			'class="mete-chip warn" title="nvidia: no key (METE: Set provider key)"><span aria-hidden="true" class="codicon codicon-key"></span>nvidia<',
		);
		const empty = html(homeModel({ ok: true, value: [] }, AT));
		expect(empty).toContain(
			"The providers&#x27; states show once the daemon answers.",
		);
		// A sentence, not a label: it wraps rather than ending in an ellipsis.
		expect(empty).toContain('class="mete-note"');
	});

	it("lists the folders opened before, newest first, the open one marked and the others as links", () => {
		const out = html(homeModel({ ok: true, value: [] }, AT), [
			{
				uri: "file:///w/site",
				name: "site",
				path: "/w/site",
				current: true,
			},
			{
				uri: "file:///w/game",
				name: "game",
				path: "/w/game",
				current: false,
			},
		]);
		const list = out.slice(
			out.indexOf('aria-label="Workspaces"'),
			out.indexOf('aria-label="Quota"'),
		);
		expect(list).toContain("site <span");
		expect(list).toContain("(open)");
		expect(list).toMatch(/<button type="button"[^>]*>game<\/button>/);
		// Each path takes one line that ends in an ellipsis (the mete-sub rule); the tooltip keeps
		// the whole path.
		expect(list).toContain('<li class="mete-item" title="/w/game">');
		expect(list).toContain('class="mete-sub mete-mono"');
		// The open folder cannot be forgotten; the others can, and a folder can be added.
		expect(list.match(/>Forget</g)).toHaveLength(1);
		expect(list).toContain('aria-label="Forget game"');
		expect(list).toContain(">Open folder…</button>");
	});

	it("shows the folder that holds a workspace, cut at the front", () => {
		const at = (path: string, name: string) =>
			parentTail({ uri: "file:///x", name, path, current: false });
		expect(at("/w/game", "game")).toBe("/w");
		expect(
			at(
				String.raw`C:\Users\me\AppData\Local\Temp\claude\0123456789abcdef\scratchpad\gate-game4`,
				"gate-game4",
			),
		).toBe(String.raw`…\0123456789abcdef\scratchpad`);
	});

	it("opens another folder in a new window only while a run here is running or queued", () => {
		const of = (status: string) =>
			runsHere(homeModel({ ok: true, value: [run(status, "g", null)] }, AT));
		expect(of("running")).toBe(true);
		expect(of("queued")).toBe(true);
		expect(of("paused")).toBe(false);
		expect(of("completed")).toBe(false);
		expect(runsHere({ kind: "loading" })).toBe(false);
		// A daemon restart waits for the same runs (Set key, Apply now).
		expect(
			activeRunsOf(
				["running", "queued", "paused", "completed"].map((s) =>
					run(s, "g", null),
				) as StatusRuns,
			),
		).toBe(2);
	});

	it("marks the run the Team panel shows, and only that one", () => {
		const shownRun = run("completed", "shown goal", null);
		const out = renderToStaticMarkup(
			createElement(RunsSection, {
				model: homeModel(
					{ ok: true, value: [shownRun, run("completed", "other goal", null)] },
					AT,
				),
				onRefresh: none,
				onAct: none,
				onSetKey: none,
				onStart: none,
				shown: shownRun.id,
			}),
		);
		expect(out.match(/aria-current="true"/g)).toHaveLength(1);
		expect(
			out.slice(out.indexOf("aria-current"), out.indexOf("other goal")),
		).toContain("shown goal");
	});

	it("says nothing waits when no run waits for an answer", () => {
		const out = html(
			homeModel({ ok: true, value: [run("completed", "done", null)] }, AT),
		);
		expect(out).toContain("Nothing waits for you.");
		expect(out).not.toContain(">Approve<");
	});

	it("offers to set a provider key while METE is not ready, and only then", () => {
		const notReady = html(
			homeModel(
				{ ok: false, error: { code: "not_ready", detail: "no key" } },
				AT,
			),
		);
		expect(notReady).toContain(">Set provider key…<");
		const stopped = html(
			homeModel(
				{ ok: false, error: { code: "stopped", detail: "exit code 1" } },
				AT,
			),
		);
		expect(stopped).not.toContain("Set provider key");
	});
});
