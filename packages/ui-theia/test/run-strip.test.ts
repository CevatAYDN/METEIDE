import { EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	chipsOf,
	type RunEntry,
	tookText,
} from "../src/application/run-strip.js";
import { RunStrip } from "../src/application/run-strip-view.js";

// The run strip's chips (ADR-094) on a run's entry of mete/status and a folded view, at a fixed "now".

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
const texts = (...a: Parameters<typeof chipsOf>) =>
	chipsOf(...a).map((c) => c.text);

describe("chipsOf", () => {
	it("says status, team, start, autonomy and limits of a running run, then its calls, tokens and checkpoints", () => {
		expect(texts({ run: RUN, teamName: "Web development" }, VIEW, NOW)).toEqual(
			[
				"Running",
				"Web development",
				expect.stringMatching(/^started \d{2}[:.]\d{2}$/),
				"Autonomy 2: approve risky actions",
				"up to 150 requests, 6 h",
				"16 calls · 250k tokens",
				"2 checkpoints",
			],
		);
	});

	it("tells how long a run took once it ended, and not before", () => {
		const done: RunEntry = {
			...RUN,
			status: "completed",
			endedAt: "2026-10-24T15:14:20",
		};
		expect(texts({ run: done }, EMPTY_TEAM_VIEW, NOW)).toContain("took 14 min");
		expect(texts({ run: RUN }, EMPTY_TEAM_VIEW, NOW).join()).not.toContain(
			"took",
		);
	});

	it("words the team by its id until its file is read, and a run without a team as a single agent", () => {
		expect(texts({ run: RUN }, EMPTY_TEAM_VIEW, NOW)).toContain("Web dev");
		expect(
			texts({ run: { ...RUN, templateId: null } }, EMPTY_TEAM_VIEW, NOW),
		).toContain("Single agent");
	});

	it("gives every status its word and a tone, a failure bad and a pause a warning", () => {
		const of = (status: RunEntry["status"]) =>
			chipsOf({ run: { ...RUN, status } }, EMPTY_TEAM_VIEW, NOW)[0];
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
			).map((s) => of(s)?.text),
		).toEqual(["Queued", "Running", "Paused", "Done", "Failed", "Cancelled"]);
		expect(of("failed")?.tone).toBe("bad");
		expect(of("paused")?.tone).toBe("warn");
		expect(of("completed")?.tone).toBe("good");
		expect(of("running")?.tone).toBe("accent");
		expect(of("queued")?.tone).toBe("muted");
		expect(of("cancelled")?.tone).toBe("muted");
	});

	it("draws only what the events say while the run's entry has not come, and nothing for an empty run", () => {
		expect(texts({}, VIEW, NOW)).toEqual([
			"16 calls · 250k tokens",
			"2 checkpoints",
		]);
		expect(chipsOf({}, EMPTY_TEAM_VIEW, NOW)).toEqual([]);
		expect(
			texts({}, { ...VIEW, checkpoints: VIEW.checkpoints.slice(0, 1) }, NOW),
		).toContain("1 checkpoint");
	});

	it("writes a duration in minutes, then hours, and a short one as under a minute", () => {
		expect(tookText(20_000)).toBe("took under a minute");
		expect(tookText(14 * 60_000)).toBe("took 14 min");
		expect(tookText(65 * 60_000)).toBe("took 1 h 5 min");
	});
});

describe("RunStrip", () => {
	it("lists the chips with their icons, and nothing for a run without facts", () => {
		const out = renderToStaticMarkup(
			createElement(RunStrip, { facts: { run: RUN }, view: VIEW }),
		);
		expect(out.match(/<li>/g)).toHaveLength(7);
		expect(out).toContain("codicon-play");
		expect(out).toContain("codicon-shield");
		expect(
			renderToStaticMarkup(
				createElement(RunStrip, { facts: {}, view: EMPTY_TEAM_VIEW }),
			),
		).toBe("");
	});
});
