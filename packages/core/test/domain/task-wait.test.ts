import { parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	currentWait,
	waitSignature,
	withTaskWait,
} from "../../src/domain/task-wait.js";
import { applyTask, TeamStateSchema, teamOf } from "../../src/domain/team.js";

const prepared = () => {
	const parsed = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "waiting", name: "Waiting", version: "1.0.0" },
		pattern: "pipeline",
		roles: [
			{
				id: "writer",
				name: "Writer",
				goal: "Write",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: [{ id: "a", role: "writer", title: "A", approval: "human" }],
	});
	if (!parsed.ok) throw new Error("invalid fixture");
	const team = teamOf(parsed.value);
	return applyTask(
		applyTask(team, "a", { type: "START", agentId: crypto.randomUUID() }).team,
		"a",
		{ type: "SUBMIT", report: "ready" },
	).team;
};

describe("persistent task wait identity", () => {
	it("roundtrips the exact identity and invalidates a changed task state", () => {
		const team = prepared();
		const entry = team.tasks.a;
		if (!entry) throw new Error("missing fixture task");
		const waiting = withTaskWait(team, "a", {
			request: {
				kind: "approval",
				requestId: crypto.randomUUID(),
				runId: crypto.randomUUID(),
				taskId: entry.id,
				templateTaskId: "a",
				title: "A",
			},
			signature: waitSignature(entry),
			stage: "human",
		});
		const restored = TeamStateSchema.parse(JSON.parse(JSON.stringify(waiting)));
		expect(currentWait(restored.tasks.a ?? entry)?.request.requestId).toBe(
			waiting.tasks.a?.wait?.request.requestId,
		);
		expect(
			currentWait({
				...entry,
				wait: waiting.tasks.a?.wait,
				context: { ...entry.context, report: "changed" },
			}),
		).toBeUndefined();
		expect(
			withTaskWait(restored, "a", undefined).tasks.a?.wait,
		).toBeUndefined();
	});
});
