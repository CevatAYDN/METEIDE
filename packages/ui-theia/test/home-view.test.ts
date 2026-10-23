import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView } from "../src/application/home-view.js";
import { type HomeModel, homeModel } from "../src/domain/home-model.js";
import type { StatusRuns } from "../src/domain/status-service.js";

// The Home view rendered to HTML on Node: no DOM and no Theia widget, only the view and its model.

const AT = "2026-10-23T10:00:00.000Z";

const html = (model: HomeModel) =>
	renderToStaticMarkup(
		createElement(HomeView, {
			model,
			onRefresh: () => {},
			onAct: () => {},
			onSetKey: () => {},
		}),
	);

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
			'<button type="button" class="theia-button">Refresh</button>',
		);
	});

	it("lists the runs by status, goal and template, with the time of the snapshot", () => {
		const out = html(
			homeModel(
				{
					ok: true,
					value: [
						run("paused", "fix <the> bug", "research"),
						run("completed", "notes", null),
					],
				},
				AT,
			),
		);
		expect(out).toContain('<th scope="col"');
		expect(out).toContain(">paused</td>");
		expect(out).toContain("fix &lt;the&gt; bug");
		expect(out).toContain(" · research");
		expect(out).toContain(">completed</td>");
		expect(out).toContain("As of ");
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

	it("lists the runs that wait for you above the recent runs, with the answers each can take", () => {
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
		expect(out.indexOf("Waiting for you")).toBeLessThan(
			out.indexOf("Recent runs"),
		);
		const inbox = out.slice(
			out.indexOf("Waiting for you"),
			out.indexOf("Recent runs"),
		);
		expect(inbox).toContain("team goal");
		expect(inbox).toContain("single goal");
		expect(inbox).not.toContain("quota goal");
		expect(inbox.match(/>Approve</g)).toHaveLength(1);
		expect(inbox.match(/>Revise…</g)).toHaveLength(1);
		expect(inbox.match(/>Resume</g)).toHaveLength(2);
		expect(inbox).toContain("unless .mete/policy.yaml allows it");
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
		expect(out).not.toContain("groq");
		expect(out.slice(out.indexOf("done goal"))).not.toContain("<li>");
	});

	it("lets each run's goal open the run in the team panel", () => {
		const r = run("completed", "notes", null);
		const out = renderToStaticMarkup(
			createElement(HomeView, {
				model: homeModel({ ok: true, value: [r] }, AT),
				onRefresh: () => {},
				onAct: () => {},
				onSetKey: () => {},
			}),
		);
		expect(out).toContain('title="Open in the team panel"');
		expect(out).toMatch(
			/<button type="button"[^>]*title="Open in the team panel">notes<\/button>/,
		);
	});

	it("shows no inbox when nothing waits", () => {
		const out = html(
			homeModel({ ok: true, value: [run("completed", "done", null)] }, AT),
		);
		expect(out).not.toContain("Waiting for you");
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
