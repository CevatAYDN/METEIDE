import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	heroOf,
	type RunEntry,
	type RunFacts,
	tookText,
} from "../src/application/run-hero.js";
import { RunHero } from "../src/application/run-hero-view.js";

// The hero band (ADR-094, ADR-127) on a run's entry of mete/status and a folded view, at a fixed "now".

const NOW = new Date("2026-10-24T18:00:00");
const AT = "2026-10-24T15:00:00";
const RUN: RunEntry = {
	id: "r1",
	workspaceId: "w1",
	templateId: "web-dev",
	goal: "Build a page",
	status: "running",
	autonomyLevel: 2,
	budget: { cloudRequests: 150, maxHours: 6 },
	createdAt: AT,
	startedAt: AT,
};
const usage = (calls: number, tokens: number) => ({
	calls,
	tokens,
	last: { prompt: 1, providerId: "groq", modelId: "m" },
});
const agent = (id: string, u?: ReturnType<typeof usage>) => ({
	id,
	roleId: id,
	providerId: "groq",
	modelId: "m",
	thinking: false,
	...(u ? { usage: u } : {}),
});
const VIEW: TeamView = {
	...EMPTY_TEAM_VIEW,
	agents: [
		agent("a", usage(10, 60_000)),
		agent("b", usage(6, 190_000)),
		agent("c"),
	],
	checkpoints: [
		{ id: "e1", ref: "refs/mete/checkpoints/r1/1", n: 1, at: AT },
		{ id: "e2", ref: "refs/mete/checkpoints/r1/2", n: 2, at: AT },
	],
};
const event = (type: string, payload: object, taskId: string): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: AT,
		schema: 1,
		workspaceId: "w1",
		runId: "r1",
		taskId,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

// Two members, the planner's task approved and the developer's waiting for it.
const TEAM = applyAll("r1", EMPTY_TEAM_VIEW, [
	event(
		"task.created",
		{ title: "Plan", roleId: "planner", dependsOn: [] },
		"t1",
	),
	event(
		"task.created",
		{ title: "Build", roleId: "developer", dependsOn: ["t1"] },
		"t2",
	),
	event("task.status.changed", { from: "submitted", to: "approved" }, "t1"),
]);

const factTexts = (...a: Parameters<typeof heroOf>) =>
	heroOf(...a).facts.map((f) => f.text);

describe("heroOf", () => {
	it("gives a running run's status, its team, start, autonomy and limits, and its calls, tokens and checkpoints as tiles", () => {
		const hero = heroOf({ run: RUN, teamName: "Web development" }, VIEW, NOW);
		expect(hero.status).toEqual({
			status: "running",
			word: "Running",
			tone: "accent",
		});
		expect(hero.facts.map((f) => f.text)).toEqual([
			"Web development",
			expect.stringMatching(/^started \d{2}[:.]\d{2}$/),
			"Autonomy 2: approve risky actions",
			"up to 150 requests, 6 h",
		]);
		expect(hero.tiles.map((t) => `${t.caption} ${t.value}`)).toEqual([
			"Calls 16",
			"Tokens 250k",
			"Checkpoints 2",
		]);
	});

	it("tells how long a run took once it ended, and not before", () => {
		const done: RunEntry = {
			...RUN,
			status: "completed",
			endedAt: "2026-10-24T15:14:20",
		};
		expect(factTexts({ run: done }, EMPTY_TEAM_VIEW, NOW)).toContain(
			"took 14 min",
		);
		expect(factTexts({ run: RUN }, EMPTY_TEAM_VIEW, NOW).join()).not.toContain(
			"took",
		);
	});

	it("tells how long an ended run was paused, from a minute on (ADR-139)", () => {
		const done: RunEntry = {
			...RUN,
			status: "completed",
			endedAt: "2026-10-24T15:14:20",
		};
		const pausedFor = (ms: number): TeamView => ({
			...EMPTY_TEAM_VIEW,
			signals: { ...EMPTY_TEAM_VIEW.signals, paused: ms },
		});
		expect(factTexts({ run: done }, pausedFor(12 * 60_000), NOW)).toEqual(
			expect.arrayContaining(["took 14 min", "paused 12 min"]),
		);
		expect(factTexts({ run: done }, pausedFor(65 * 60_000), NOW)).toContain(
			"paused 1 h 5 min",
		);
		// Ten seconds of waiting round to nothing, and a run not ended tells no pause.
		expect(
			factTexts({ run: done }, pausedFor(10_000), NOW).join(),
		).not.toContain("paused");
		expect(
			factTexts({ run: RUN }, pausedFor(12 * 60_000), NOW).join(),
		).not.toContain("paused");
	});

	it("words the team by its id until its file is read, and a run without a team as a single agent", () => {
		expect(factTexts({ run: RUN }, EMPTY_TEAM_VIEW, NOW)).toContain("Web dev");
		expect(
			factTexts({ run: { ...RUN, templateId: null } }, EMPTY_TEAM_VIEW, NOW),
		).toContain("Single agent");
	});

	it("gives every status its word and a tone, a failure bad and a pause a warning", () => {
		const of = (status: RunEntry["status"]) =>
			heroOf({ run: { ...RUN, status } }, EMPTY_TEAM_VIEW, NOW).status;
		expect(
			(
				[
					"queued",
					"running",
					"paused",
					"completed",
					"failed",
					"cancelled",
				] as const
			).map((s) => of(s)?.word),
		).toEqual(["Queued", "Running", "Paused", "Done", "Failed", "Cancelled"]);
		expect(of("failed")?.tone).toBe("bad");
		expect(of("paused")?.tone).toBe("warn");
		expect(of("completed")?.tone).toBe("good");
		expect(of("running")?.tone).toBe("accent");
		expect(of("queued")?.tone).toBe("muted");
		expect(of("cancelled")?.tone).toBe("muted");
	});

	it("shows only what the events say while the run's entry has not come, and a team's progress once it has tasks", () => {
		const hero = heroOf({}, VIEW, NOW);
		expect(hero.status).toBeUndefined();
		expect(hero.facts).toEqual([]);
		expect(hero.tiles.map((t) => t.value)).toEqual(["16", "250k", "2"]);
		expect(hero.progress).toBeUndefined();
		expect(heroOf({}, TEAM, NOW).progress).toEqual({ done: 1, total: 2 });
	});

	it("writes a duration in minutes, then hours, and a short one as under a minute", () => {
		expect(tookText(20_000)).toBe("took under a minute");
		expect(tookText(14 * 60_000)).toBe("took 14 min");
		expect(tookText(65 * 60_000)).toBe("took 1 h 5 min");
	});
});

describe("RunHero", () => {
	it("puts the status over the goal, and for a team run the ring of its approved tasks and a tile per member (ADR-127)", () => {
		const out = renderToStaticMarkup(
			createElement(RunHero, {
				goal: "Build a page",
				facts: { run: RUN },
				view: TEAM,
				names: { developer: "Frontend developer" },
				onResume: () => {},
			}),
		);
		expect(out.indexOf('role="status"')).toBeLessThan(out.indexOf("<h2"));
		expect(out).toContain('aria-label="1 of 2 tasks done"');
		expect(out).toContain('data-state="done"');
		expect(out).toContain(">Frontend developer<");
		expect(out).toContain(">Planner<");
		const single = renderToStaticMarkup(
			createElement(RunHero, {
				goal: "Answer",
				facts: {},
				view: VIEW,
				names: {},
				onResume: () => {},
			}),
		);
		expect(single).not.toContain("Team at a glance");
		expect(single).not.toContain('role="status"');
	});

	it("gives a settled status its glyph and puts a single agent's tiles at the band's right (ADR-128)", () => {
		const hero = (run: RunEntry, view: TeamView) =>
			renderToStaticMarkup(
				createElement(RunHero, {
					goal: "Answer",
					facts: { run },
					view,
					names: {},
					onResume: () => {},
				}),
			);
		const done = hero({ ...RUN, templateId: null, status: "completed" }, VIEW);
		expect(done).toMatch(
			/role="status"[^>]*><span aria-hidden="true" class="codicon codicon-check"/,
		);
		expect(done).toMatch(/<\/div><dl class="mete-tiles">/);
		const team = hero(RUN, TEAM);
		expect(team).toMatch(/data-status="running"[^>]*>Running</);
		expect(team).toMatch(/<dl class="mete-tiles">[\s\S]*<\/dl><\/div><section/);
	});
});

describe("RunHero under a pause someone must go on with (docs/13, Team panel; ADR-126)", () => {
	const paused = (
		pauseReason: NonNullable<RunEntry["pauseReason"]>,
		blocked: RunFacts["blocked"] = [],
	) =>
		renderToStaticMarkup(
			createElement(RunHero, {
				goal: "Build a page",
				facts: { run: { ...RUN, status: "paused", pauseReason }, blocked },
				view: TEAM,
				names: {},
				onResume: () => {},
			}),
		);

	it("shows the side-bar row's Resume under a user's pause", () => {
		const out = paused("user");
		expect(out.match(/>Resume<\/button>/g)).toHaveLength(1);
		expect(out).not.toContain("It used its budget");
		expect(out.indexOf('role="status"')).toBeLessThan(out.indexOf(">Resume<"));
	});

	it("names the budget before Resume under a budget pause", () => {
		const out = paused("budget");
		expect(out).toContain("It used its budget: 25 model turns at a time");
		expect(out.indexOf("It used its budget")).toBeLessThan(
			out.indexOf(">Resume</button>"),
		);
	});

	it("lists why each provider cannot carry a quota pause on, then Resume now", () => {
		const out = paused("quota", [
			{ id: "groq", state: "no_key" },
			{ id: "custom:x", state: "unusable" },
		]);
		expect(out).toContain("groq: no key");
		expect(out).toContain("custom:x: none of its models can be used here");
		expect(out).toContain(">Resume now</button>");
	});

	it("offers nothing to a running run, an approval pause or a network pause", () => {
		for (const out of [
			renderToStaticMarkup(
				createElement(RunHero, {
					goal: "Build a page",
					facts: { run: RUN },
					view: TEAM,
					names: {},
					onResume: () => {},
				}),
			),
			paused("approval"),
			paused("network"),
		])
			expect(out).not.toContain(">Resume");
	});
});
