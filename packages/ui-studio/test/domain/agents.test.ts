import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { applyAll, EMPTY_TEAM_VIEW } from "../../src/domain/team-view.js";

// The agents of a run from hand-written events with the envelope ids the core sets.

const RUN = crypto.randomUUID();
const TASK = crypto.randomUUID();
const WRITER = crypto.randomUUID();

const event = (
	type: string,
	payload: object,
	agentId: string | null = WRITER,
	taskId: string | null = TASK,
): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-23T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		...(taskId ? { taskId } : {}),
		...(agentId ? { agentId } : {}),
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const created = event("agent.created", {
	roleId: "writer",
	providerId: "groq",
	modelId: "openai/gpt-oss-120b",
});

describe("the agents of the team view", () => {
	it("creates an agent with its role, model and task, and follows its thinking and tools", () => {
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created,
			event("agent.thinking.started", {}),
			event("agent.tool.called", {
				capability: "fs.read@1",
				adapterId: "tools-fs",
			}),
		]);
		expect(view.agents).toEqual([
			{
				id: WRITER,
				roleId: "writer",
				providerId: "groq",
				modelId: "openai/gpt-oss-120b",
				taskId: TASK,
				thinking: true,
				tool: "fs.read@1",
			},
		]);
		const after = applyAll(RUN, view, [
			event("agent.tool.completed", {
				capability: "fs.read@1",
				ok: true,
				durationMs: 3,
			}),
			event("agent.thinking.ended", {}),
			event("agent.model.changed", {
				from: { providerId: "groq", modelId: "openai/gpt-oss-120b" },
				to: { providerId: "openrouter", modelId: "x:free" },
				reason: "quota",
			}),
		]);
		expect(after.agents).toEqual([
			{
				id: WRITER,
				roleId: "writer",
				providerId: "openrouter",
				modelId: "x:free",
				taskId: TASK,
				thinking: false,
			},
		]);
	});

	it("keeps a tool's last progress step on the agent until the call completes (ADR-067)", () => {
		const step = (progress: number) =>
			event("agent.tool.progress", {
				capability: "mcp.tools@1",
				progress,
				total: 4,
			});
		const during = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created,
			event("agent.tool.called", {
				capability: "mcp.tools@1",
				adapterId: "mcp-client",
			}),
			step(1),
			step(3),
		]);
		expect(during.agents[0]?.progress).toEqual({ progress: 3, total: 4 });
		const after = applyAll(RUN, during, [
			event("agent.tool.completed", {
				capability: "mcp.tools@1",
				ok: true,
				durationMs: 9,
			}),
		]);
		expect(after.agents[0]).not.toHaveProperty("progress");
		expect(after.agents[0]).not.toHaveProperty("tool");
	});

	it("keeps a single agent without a task, and ignores events of no agent or an unknown one", () => {
		const solo = event(
			"agent.created",
			{ roleId: "agent", providerId: "groq", modelId: "m" },
			WRITER,
			null,
		);
		const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
			solo,
			event(
				"agent.created",
				{ roleId: "x", providerId: "p", modelId: "m" },
				null,
			),
			event("agent.thinking.started", {}, crypto.randomUUID()),
		]);
		expect(view.agents).toEqual([
			{
				id: WRITER,
				roleId: "agent",
				providerId: "groq",
				modelId: "m",
				thinking: true,
			},
		]);
	});
});
