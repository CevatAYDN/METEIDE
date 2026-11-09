import { randomUUID } from "node:crypto";
import { parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { initialTransition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import {
	syncSeatedWorker,
	workerProgress,
} from "../../src/domain/task-worker.js";
import { applyTask, teamOf } from "../../src/domain/team.js";
import {
	reportSha256,
	withVerification,
} from "../../src/domain/verification.js";

const fixture = () => {
	const parsed = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "cycle", name: "Cycle", version: "1.0.0" },
		pattern: "single",
		roles: [
			{
				id: "dev",
				name: "Dev",
				goal: "Build",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: [
			{ id: "build", role: "dev", title: "Build", verify: [{ run: "check" }] },
		],
	});
	if (!parsed.ok) throw new Error("bad fixture");
	const team = applyTask(teamOf(parsed.value), "build", {
		type: "START",
		agentId: randomUUID(),
	}).team;
	const checked = withVerification(team, "build", {
		evaluationId: randomUUID(),
		attemptId: team.tasks.build?.id ?? "",
		attemptNumber: 1,
		startedAt: new Date(0).toISOString(),
		reportSha256: reportSha256("same"),
		gates: [
			{
				index: 0,
				gate: "check",
				optional: false,
				status: "passed",
				details: "",
			},
		],
	});
	const context = initialTransition(runMachine, {
		goal: "cycle",
		priority: 1,
		messages: [],
	})[0].context;
	return {
		...context,
		task: "build",
		team: checked,
		messages: [{ role: "assistant" as const, content: "same" }],
	};
};

describe("authoritative verification cycles", () => {
	it("clears proof on a new worker reply even when the text repeats", () => {
		const run = fixture();
		const session = { turns: 1, tainted: false, checkpointed: -1 };
		expect(
			workerProgress(run, {
				type: "WORKER",
				task: "build",
				messages: run.messages,
				session,
				requests: 1,
			}).team?.tasks.build?.verification,
		).toBeUndefined();
		expect(
			syncSeatedWorker(run, {
				type: "REPLIED",
				message: run.messages[0] ?? { role: "assistant", content: "same" },
				finish: "stop",
			}).team?.tasks.build?.verification,
		).toBeUndefined();
	});
	it("retains proof for checkpoint/seat synchronization and coordinator replies", () => {
		const run = fixture();
		const original = run.team.tasks.build?.verification;
		expect(
			workerProgress(run, {
				type: "WORKER",
				task: "build",
				messages: run.messages,
				session: { turns: 0, tainted: false, checkpointed: 1 },
				requests: 0,
			}).team?.tasks.build?.verification,
		).toEqual(original);
		expect(
			syncSeatedWorker(run, { type: "CHECKPOINTED", step: 1 }).team?.tasks.build
				?.verification,
		).toEqual(original);
		expect(
			syncSeatedWorker(
				{ ...run, review: "dev" },
				{
					type: "REPLIED",
					message: { role: "assistant", content: "approve" },
					finish: "stop",
				},
			).team?.tasks.build?.verification,
		).toEqual(original);
	});
});
