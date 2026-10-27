import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NowSlot } from "../src/application/now-slot.js";

// The Now slot (ADR-127) on views the real fold built.

const RUN = crypto.randomUUID();
const TASK = crypto.randomUUID();
const AGENT = crypto.randomUUID();

const event = (type: string, payload: object, agentId?: string): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-27T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		taskId: TASK,
		source: "core-engine",
		type,
		payload,
		...(agentId ? { agentId } : {}),
	}) as MeteEvent;

// The developer's second model call in flight, after a first that used 32 000 prompt tokens.
const THINKING = applyAll(RUN, EMPTY_TEAM_VIEW, [
	event("task.created", { title: "Build", roleId: "developer", dependsOn: [] }),
	event(
		"agent.created",
		{ roleId: "developer", providerId: "groq", modelId: "llama-3.3-70b" },
		AGENT,
	),
	event(
		"agent.thinking.ended",
		{ usage: { prompt: 32_000, completion: 500 } },
		AGENT,
	),
	event("agent.thinking.started", {}, AGENT),
]);

const html = (view: TeamView) =>
	renderToStaticMarkup(
		createElement(NowSlot, {
			view,
			names: {},
			windows: { "groq/llama-3.3-70b": 128_000 },
			waiting: {
				onApprove: () => {},
				onRevise: () => {},
				onResume: () => {},
				onShowFiles: () => {},
				onOpen: () => {},
			},
		}),
	);

describe("the Now slot", () => {
	it("shows the member whose model call is in flight, with its seconds, its model and its context share", () => {
		const out = html(THINKING);
		expect(out).toContain('aria-label="Now"');
		expect(out).toContain(">Developer<");
		expect(out).toContain("Thinking… ");
		expect(out).toContain("groq · llama-3.3-70b");
		expect(out).toContain("Context 25% · ");
		expect(out).toContain("mete-dots");
	});

	it("shows a tool call's progress, the Waiting for you cards while the user is asked, and nothing at rest", () => {
		const working = applyAll(RUN, THINKING, [
			event("agent.tool.called", { capability: "fs.read@1" }, AGENT),
			event("agent.tool.progress", { progress: 3, total: 10 }, AGENT),
		]);
		expect(html(working)).toContain("Working with fs.read");
		expect(html(working)).toContain(">3/10<");
		const asked = applyAll(RUN, THINKING, [
			event("run.paused", { reason: "approval" }),
		]);
		expect(html(asked)).toContain("Waiting for you");
		expect(html(asked)).not.toContain('aria-label="Now"');
		expect(html(EMPTY_TEAM_VIEW)).toBe("");
	});
});
