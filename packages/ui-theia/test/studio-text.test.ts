import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { describe, expect, it } from "vitest";
import { studioText } from "../src/application/studio-text.js";

// The sentences of the Studio's accessible list, from hand-written events.

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
		ts: "2026-10-23T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		source: "core-engine",
		type,
		payload,
		...more,
	}) as MeteEvent;

const view = applyAll(RUN, EMPTY_TEAM_VIEW, [
	event(
		"task.created",
		{ title: "Build", roleId: "dev", dependsOn: [] },
		{ taskId: TASK },
	),
	event(
		"agent.created",
		{ roleId: "dev", providerId: "groq", modelId: "m" },
		{ agentId: DEV, taskId: TASK },
	),
]);

describe("the Studio's sentences", () => {
	it("says what the room shows for each event, naming the task, the role or the provider", () => {
		const said = (
			type: string,
			payload: object,
			more: Partial<MeteEvent> = {},
		) =>
			studioText(
				view,
				event(type, payload, { taskId: TASK, agentId: DEV, ...more }),
			);
		expect(
			said("task.status.changed", { from: "submitted", to: "approved" }),
		).toBe("Build is approved and moves to Done.");
		expect(
			said("task.status.changed", { from: "todo", to: "in_progress" }),
		).toBe("Build is now in_progress.");
		expect(
			said("agent.tool.called", {
				capability: "fs.read@1",
				adapterId: "tools-fs",
			}),
		).toBe("dev uses fs.read@1.");
		expect(said("approval.requested", { approver: "human" })).toBe(
			"Build waits for your approval.",
		);
		expect(said("run.paused", { reason: "network" })).toBe(
			"The network is down; the room dims.",
		);
		expect(
			said("quota.exhausted", {
				providerId: "groq",
				unit: "requests_per_day",
				resetsAt: "2026-10-24T00:00:00.000Z",
			}),
		).toBe(
			"groq's free quota is used up; its agents wait at the coffee corner.",
		);
		// The first thinking.started of an agent carries no agent id: its task's agent stands in.
		expect(
			studioText(view, event("agent.thinking.started", {}, { taskId: TASK })),
		).toBe("dev is thinking.");
		expect(
			said("checkpoint.created", {
				kind: "git",
				ref: "refs/mete/checkpoints/r/1",
			}),
		).toBe("checkpoint.created");
	});
});
