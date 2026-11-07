import { EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatBoard } from "../src/application/chat-board.js";
import type { RunFacts } from "../src/application/run-hero.js";

const render = (run: RunFacts) =>
	renderToStaticMarkup(
		createElement(ChatBoard, {
			model: { goal: "Review this project", view: EMPTY_TEAM_VIEW, feed: [] },
			controls: {
				run,
				names: {},
				windows: {},
				transcript: {},
				waiting: {
					onResume: () => {},
					onApprove: () => {},
					onRevise: () => {},
					onShowFiles: () => {},
				},
				onOpenReport: () => {},
				markdown: {
					render: () => {
						throw new Error("browser only");
					},
				},
				onReply: async () => undefined,
				tools: createElement("button", { type: "button" }, "Tools"),
				restore: { onRestore: () => {} },
			},
			details: "Model selection",
		}),
	);

it("replaces the large run hero with a compact status and collapsed metrics", () => {
	const out = render({});
	expect(out).toContain('class="mete-chat-header"');
	expect(out).not.toContain('class="mete-hero"');
	expect(out).toContain('<details class="mete-chat-details"><summary>');
	expect(out).toContain("<dt>Calls</dt>");
	expect(out).not.toMatch(/<details[^>]* open/);
	expect(out.indexOf("<dt>Calls</dt>")).toBeGreaterThan(
		out.indexOf("<details"),
	);
	expect(out.indexOf("Model selection")).toBeLessThan(out.indexOf("<form"));
	expect(out.indexOf(">Tools<")).toBeGreaterThan(out.indexOf("<form"));
});

it("keeps resume outside the closed diagnostic disclosure", () => {
	const out = render({
		run: {
			id: "run",
			workspaceId: "workspace",
			templateId: null,
			goal: "Review this project",
			status: "paused",
			pauseReason: "user",
			autonomyLevel: 1,
			budget: { cloudRequests: 10, maxHours: 1 },
			createdAt: "2026-11-07T10:00:00Z",
		},
	});
	expect(out).toContain("Paused");
	expect(out).toContain(">Resume<");
	expect(out.indexOf(">Resume<")).toBeLessThan(out.indexOf("<details"));
});
