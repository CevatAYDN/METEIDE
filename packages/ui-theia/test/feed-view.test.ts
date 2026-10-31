import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { inFeed } from "../src/application/feed-rows.js";
import { FeedView, feedRows } from "../src/application/feed-view.js";

// The Team view's Activity feed (ADR-092) over a view the real fold built.

const RUN = crypto.randomUUID();
const TASK = crypto.randomUUID();
const DEV = crypto.randomUUID();

const event = (
	type: string,
	payload: object,
	more: Partial<MeteEvent> = {},
): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-24T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		source: "core-engine",
		type,
		payload,
		...more,
	}) as MeteEvent;
const ofTask = { taskId: TASK };
const ofDev = { taskId: TASK, agentId: DEV };

const created = event(
	"task.created",
	{ title: "Build", roleId: "dev", dependsOn: [] },
	ofTask,
);
const agent = event(
	"agent.created",
	{ roleId: "dev", providerId: "groq", modelId: "m" },
	ofDev,
);
const view = applyAll(RUN, EMPTY_TEAM_VIEW, [created, agent]);

const assigned = event("task.assigned", { agentId: DEV }, ofTask);
const asked = event("approval.requested", { approver: "lead" }, ofDev);
const revised = event(
	"approval.resolved",
	{ approver: "lead", decision: "revise", feedback: "Add tests" },
	ofTask,
);
const tool = event(
	"agent.tool.completed",
	{ capability: "fs.write@1", ok: true, durationMs: 140.4 },
	ofDev,
);
const done = event("run.completed", { summary: "ok" });
const feed = [assigned, asked, revised, tool, done];

const lines = (rows: ReturnType<typeof feedRows>["rows"]) =>
	rows.map((r) => [r.line.who, r.line.to, r.line.text, r.line.quote]);

describe("the Activity feed", () => {
	it("says who did what and who asked whom, newest first", () => {
		expect(lines(feedRows(view, feed, "all").rows)).toEqual([
			[undefined, undefined, "The run is complete.", undefined],
			["dev", undefined, "uses fs.write@1 · 140 ms", undefined],
			["lead", "dev", "asks for changes to “Build”", "Add tests"],
			["dev", "lead", "asks for approval of “Build”", undefined],
			["dev", undefined, "takes “Build”", undefined],
		]);
	});

	it("shows a pair review: the ask, the return with its feedback and the pass (ADR-136)", () => {
		const review = (type: string, more: object = {}) =>
			event(type, { reviewerRoleId: "editor", ...more }, ofTask);
		const pair = [
			review("review.requested"),
			review("review.completed", {
				decision: "revise",
				feedback: "Write gününüzü.",
			}),
			review("review.completed", { decision: "approve" }),
		];
		expect(lines(feedRows(view, pair, "asks").rows)).toEqual([
			["editor", "dev", "reviews “Build”: no changes", undefined],
			["editor", "dev", "asks for changes to “Build”", "Write gününüzü."],
			["dev", "editor", "asks for a review of “Build”", undefined],
		]);
	});

	it("shows the questions asked before the work and a role's answer, and no other message (ADR-142)", () => {
		const helper = crypto.randomUUID();
		const seated = applyAll(RUN, view, [
			event(
				"agent.created",
				{ roleId: "researcher", providerId: "groq", modelId: "m" },
				{ taskId: TASK, agentId: helper },
			),
		]);
		const message = (kind: string) =>
			event(
				"agent.message.sent",
				{
					messageId: crypto.randomUUID(),
					from: helper,
					to: DEV,
					kind,
					summary: "Ankara.",
				},
				ofTask,
			);
		const asking = [
			event(
				"task.clarification.requested",
				{ toRoleId: "researcher", question: "Which city?" },
				ofTask,
			),
			message("answer"),
		];
		expect(lines(feedRows(seated, asking, "asks").rows)).toEqual([
			["researcher", "dev", "answers before “Build”", "Ankara."],
			["dev", "researcher", "asks before starting “Build”", "Which city?"],
		]);
		expect(inFeed(message("handoff"))).toBe(false);
	});

	it("shows the attempt a member takes and which attempt goes on, with the judge's reason (ADR-162)", () => {
		const second = crypto.randomUUID();
		const seated = applyAll(RUN, view, [
			event(
				"agent.created",
				{
					roleId: "dev",
					providerId: "groq",
					modelId: "m",
					attempt: { k: 2, n: 3 },
				},
				{ taskId: TASK, agentId: second },
			),
		]);
		const chosen = (by: string, reason?: string) =>
			event(
				"task.attempt.chosen",
				{ attempt: 2, of: 3, by, ...(reason ? { reason } : {}) },
				ofTask,
			);
		const attempts = [
			event("task.assigned", { agentId: second }, ofTask),
			chosen("checks"),
			chosen("judge", "It cites every claim."),
		];
		const goesOn = "goes on with attempt 2 of 3 of “Build”, chosen by";
		expect(lines(feedRows(seated, attempts, "asks").rows)).toEqual([
			["dev", undefined, `${goesOn} the judge`, "It cites every claim."],
			["dev", undefined, `${goesOn} its checks`, undefined],
			["dev", undefined, "takes “Build”, attempt 2 of 3", undefined],
		]);
	});

	it("carries the run's answer and a failure's message as the row's detail", () => {
		const failed = event("run.failed", {
			code: "unauthorized",
			message: "The key was refused.",
		});
		const rows = feedRows(view, [...feed, failed], "run").rows;
		expect(
			rows.find((r) => r.event.type === "run.completed")?.line.detail,
		).toBe("ok");
		expect(rows.find((r) => r.event.type === "run.failed")?.line.detail).toBe(
			"The key was refused.",
		);
	});

	it("filters by segment", () => {
		const of = (segment: "asks" | "work" | "run") =>
			feedRows(view, feed, segment).rows.map((r) => r.event.type);
		expect(of("asks")).toEqual([
			"approval.resolved",
			"approval.requested",
			"task.assigned",
		]);
		expect(of("work")).toEqual(["agent.tool.completed"]);
		expect(of("run")).toEqual(["run.completed"]);
	});

	it("holds back the events after the one Follow off kept, and shows all once that one is dropped", () => {
		const held = feedRows(view, feed, "all", asked.id);
		expect(held.rows.map((r) => r.event.id)).toEqual([asked.id, assigned.id]);
		expect(held.waiting).toBe(3);
		expect(feedRows(view, [], "all", "").waiting).toBe(0);
		expect(feedRows(view, [tool], "all", "").waiting).toBe(1);
		expect(feedRows(view, feed, "all", crypto.randomUUID()).waiting).toBe(0);
	});

	it("shows a status change only when its task is blocked", () => {
		const to = (status: string) =>
			inFeed(event("task.status.changed", { from: "in_progress", to: status }));
		expect(to("blocked")).toBe(true);
		expect(to("submitted")).toBe(false);
		expect(
			inFeed(event("agent.tool.called", { capability: "fs.read@1" })),
		).toBe(false);
	});

	it("names members from the team file and the human as You, on a thread of their initials, with each event's payload behind its row", () => {
		const human = event("approval.requested", { approver: "human" }, ofTask);
		const out = renderToStaticMarkup(
			createElement(FeedView, {
				view,
				feed: [...feed, human],
				names: { dev: "Developer" },
				markdown: {
					render: () => {
						throw new Error("markdown is drawn in the browser");
					},
				},
			}),
		);
		expect(out).toContain("<strong>Developer</strong>");
		expect(out).toContain("<strong>You</strong>");
		expect(out).toContain("<strong>Lead</strong>");
		expect(out).toContain("Add tests");
		expect(out).toContain('dateTime="2026-10-24T10:00:00.000Z"');
		expect(out).toContain("&quot;capability&quot;: &quot;fs.write@1&quot;");
		expect(out).toContain('aria-pressed="true">All<');
		// The thread's tiles: the initial of who acted, an ask on its warn wash (ADR-127).
		expect(out).toContain('class="mete-feed-tile" aria-hidden="true">D<');
		expect(out).toMatch(/class="mete-feed-row"[^>]*data-alert=""/);
		expect(out).toContain('role="switch"');
	});

	it("says so when the run has no activity yet", () => {
		const out = renderToStaticMarkup(
			createElement(FeedView, {
				view,
				feed: [],
				names: {},
				markdown: {
					render: () => {
						throw new Error("markdown is drawn in the browser");
					},
				},
			}),
		);
		expect(out).toContain("Nothing here yet.");
		expect(out).not.toContain("Show all");
	});
});
