import { parseTemplate } from "@mete/contracts";
import { initialTransition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import { applyTask, teamOf } from "../../src/domain/team.js";
import { engineHarness } from "./engine.js";

/** A persisted two-task human-approval fixture, with no model or external calls. */
export const controlHarness = (reason: "approval" | "user" = "approval") => {
	const h = engineHarness({ scripts: [] });
	const parsed = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "control", name: "Control", version: "1.0.0" },
		pattern: "parallel_then_synthesize",
		roles: [
			{
				id: "writer",
				name: "Writer",
				goal: "Write",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: ["a", "b"].map((id) => ({
			id,
			role: "writer",
			title: `Task ${id}`,
			approval: "human",
		})),
	});
	if (!parsed.ok) throw new Error("invalid control fixture");
	let team = teamOf(parsed.value);
	for (const id of ["a", "b"]) {
		team = applyTask(team, id, {
			type: "START",
			agentId: crypto.randomUUID(),
		}).team;
		team = applyTask(team, id, { type: "SUBMIT", report: `Report ${id}` }).team;
	}
	const [initial] = initialTransition(runMachine, {
		goal: "task control",
		priority: 1,
		messages: [],
	});
	const snapshot = runMachine.resolveState({
		value: "paused",
		context: { ...initial.context, team, pause: { reason } },
	});
	const runId = crypto.randomUUID();
	h.store.save(
		{
			id: runId,
			workspaceId: crypto.randomUUID(),
			autonomyLevel: 2,
			budget: { cloudRequests: 20, maxHours: 1 },
			createdAt: new Date(0).toISOString(),
		},
		snapshot,
	);
	return { ...h, runId };
};
