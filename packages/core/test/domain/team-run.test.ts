import { parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import {
	applyTask,
	approve,
	keepMessages,
	teamOf,
} from "../../src/domain/team.js";
import { seatOf, taskConversation } from "../../src/domain/team-run.js";

const template = () => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "research", name: "Research", version: "1.0.0" },
		pattern: "parallel_then_synthesize",
		roles: [
			{
				id: "researcher",
				name: "Researcher",
				goal: "Find sources",
				backstory: "A librarian",
				tier: "reasoning",
				needs: ["tool_calling"],
				capabilities: ["web.search@1"],
			},
			{
				id: "writer",
				name: "Writer",
				goal: "Write",
				tier: "fast",
				capabilities: [],
			},
		],
		tasks: [
			{ id: "find", role: "researcher", title: "Find sources" },
			{ id: "write", role: "writer", title: "Write it", context: ["find"] },
		],
	});
	if (!r.ok) throw new Error(r.error.issues.join("\n"));
	return r.value;
};

const where = { os: "Windows", shell: "pwsh" };
const text = (m: { content: unknown } | undefined) => String(m?.content);

describe("team run helpers", () => {
	it("seats a task's agent with its role's tier, needs and capabilities", () => {
		expect(seatOf(teamOf(template()), "find")).toEqual({
			tier: "reasoning",
			needs: ["tool_calling"],
			capabilities: ["web.search@1"],
		});
	});

	it("opens a task with its role, the goal, the task and its context reports", () => {
		let team = teamOf(template());
		team = applyTask(team, "find", { type: "START", agentId: "a" }).team;
		team = applyTask(team, "find", {
			type: "SUBMIT",
			report: "3 sources",
		}).team;
		team = approve(team, "find", "system").team;
		const [system, user] = taskConversation(
			team,
			"write",
			{ goal: "Free models" },
			where,
		);
		expect(text(system)).toContain("You are Writer");
		expect(text(system)).toContain("Operating system: Windows. Shell: pwsh.");
		expect(text(user)).toContain("Free models");
		expect(text(user)).toContain("Your task: Write it");
		expect(text(user)).toContain("Report of Find sources:\n3 sources");
	});

	it("goes on with the kept conversation and the feedback after a revision", () => {
		let team = teamOf(template());
		team = applyTask(team, "find", { type: "START", agentId: "a" }).team;
		const kept = [{ role: "user" as const, content: "earlier" }];
		team = keepMessages(team, "find", kept);
		team = applyTask(team, "find", { type: "SUBMIT", report: "r" }).team;
		team = applyTask(team, "find", {
			type: "REVISE",
			feedback: "cite more",
		}).team;
		expect(taskConversation(team, "find", { goal: "g" }, where)).toEqual([
			...kept,
			{ role: "user", content: "Feedback on your last submission: cite more" },
		]);
	});

	it("switches the run's working set to another task", () => {
		const [s] = initialTransition(runMachine, {
			goal: "g",
			priority: 1,
			messages: [],
		});
		const team = teamOf(template());
		const messages = [{ role: "user" as const, content: "x" }];
		const [next] = transition(runMachine, s, {
			type: "SWITCH",
			task: "write",
			team,
			messages,
		});
		expect(next.context).toMatchObject({ task: "write", messages, turns: 0 });
		expect(next.context.agent).toBeUndefined();
	});
});
