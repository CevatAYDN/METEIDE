import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView } from "../src/application/home-view.js";
import { type HomeModel, homeModel } from "../src/domain/home-model.js";
import type { StatusRuns } from "../src/domain/status-service.js";

// The Home view rendered to HTML on Node: no DOM and no Theia widget, only the view and its model.

const AT = "2026-10-23T10:00:00.000Z";

const html = (model: HomeModel) =>
	renderToStaticMarkup(createElement(HomeView, { model, onRefresh: () => {} }));

const run = (status: string, goal: string, templateId: string | null) =>
	({
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
});
