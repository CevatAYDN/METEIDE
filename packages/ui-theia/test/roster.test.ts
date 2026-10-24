import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { describe, expect, it } from "vitest";
import { roleWords, rosterOf } from "../src/domain/roster.js";

// The Team view's rows (ADR-089) from a view the real fold built.

const RUN = crypto.randomUUID();

const event = (
	type: string,
	payload: object,
	ids: {
		taskId?: string;
		agentId?: string;
		// undefined: a workspace event, such as quota.exhausted, names no run.
		runId?: string | undefined;
	} = {},
): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-24T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		source: "core-engine",
		type,
		payload,
		...ids,
	}) as MeteEvent;

const task = (title: string, roleId: string, dependsOn: string[] = []) => {
	const id = crypto.randomUUID();
	return {
		id,
		created: event(
			"task.created",
			{ title, roleId, dependsOn },
			{ taskId: id },
		),
		to: (to: string) =>
			event("task.status.changed", { from: "todo", to }, { taskId: id }),
	};
};

const agent = (roleId: string, taskId: string, providerId = "groq") => {
	const id = crypto.randomUUID();
	return {
		id,
		created: event(
			"agent.created",
			{ roleId, providerId, modelId: "llama-3.3-70b", tier: "coder" },
			{ taskId, agentId: id },
		),
		on: (type: string, payload: object = {}) =>
			event(type, payload, { taskId, agentId: id }),
	};
};

const roster = (events: MeteEvent[]) =>
	rosterOf(applyAll(RUN, EMPTY_TEAM_VIEW, events));

describe("the Team view's roster", () => {
	it("has one row per role in the order the run names it, with its model and task count", () => {
		const brief = task("Write the brief", "ui_designer");
		const page = task("Build the page", "frontend_developer", [brief.id]);
		const audit = task("Audit it", "qa", [page.id]);
		const designer = agent("ui_designer", brief.id, "nvidia");
		const rows = roster([
			brief.created,
			page.created,
			audit.created,
			designer.created,
			designer.on("agent.thinking.ended"),
			brief.to("approved"),
		]);
		expect(rows.map((r) => r.roleId)).toEqual([
			"ui_designer",
			"frontend_developer",
			"qa",
		]);
		const [ui, fe, qa] = rows;
		expect(ui).toMatchObject({
			state: { kind: "done" },
			done: 1,
			total: 1,
			agent: { providerId: "nvidia", modelId: "llama-3.3-70b", tier: "coder" },
		});
		// Its next task waits for nothing left, so no "waits for".
		expect(fe).toMatchObject({
			state: { kind: "idle" },
			now: { task: "Build the page" },
			done: 0,
			total: 1,
		});
		expect(fe?.now?.waitsFor).toBeUndefined();
		expect(fe?.agent).toBeUndefined();
		expect(qa?.now).toEqual({ task: "Audit it", waitsFor: "Build the page" });
	});

	it("says what each member does now: a tool call, thinking, waiting for you or for quota, blocked", () => {
		const page = task("Build the page", "frontend_developer");
		const audit = task("Audit it", "qa");
		const notes = task("Notes", "writer");
		const dev = agent("frontend_developer", page.id);
		const tester = agent("qa", audit.id, "google");
		const writer = agent("writer", notes.id);
		const base = [
			page.created,
			audit.created,
			notes.created,
			dev.created,
			tester.created,
			writer.created,
		];
		const working = roster([
			...base,
			dev.on("agent.tool.called", {
				capability: "fs.write@1",
				adapterId: "fs",
			}),
			writer.on("agent.thinking.ended"),
			notes.to("blocked"),
		]);
		expect(working[0]?.state).toEqual({ kind: "working", tool: "fs.write@1" });
		expect(working[0]?.now).toEqual({ task: "Build the page" });
		// A freshly created agent is thinking (agent.created comes inside its first turn).
		expect(working[1]?.state).toEqual({ kind: "thinking" });
		expect(working[2]?.state).toEqual({ kind: "blocked" });

		const asking = roster([
			...base,
			audit.to("submitted"),
			event("approval.requested", { approver: "human" }, { taskId: audit.id }),
			event("run.paused", { reason: "approval" }),
		]);
		expect(asking[1]?.state).toEqual({ kind: "waits_for_you" });
		// A human checkpoint: the lead approves first, then the human is asked (ADR-091).
		const afterLead = roster([
			...base,
			audit.to("submitted"),
			event("approval.requested", { approver: "lead" }, { taskId: audit.id }),
			event(
				"approval.resolved",
				{ approver: "lead", decision: "approve" },
				{ taskId: audit.id },
			),
			event("approval.requested", { approver: "human" }, { taskId: audit.id }),
			event("run.paused", { reason: "approval" }),
		]);
		expect(afterLead[1]?.state).toEqual({ kind: "waits_for_you" });

		const spent = roster([
			...base,
			event(
				"quota.exhausted",
				{
					providerId: "google",
					unit: "requests",
					resetsAt: "2026-10-24T18:00:00.000Z",
				},
				{ runId: undefined },
			),
			event("run.paused", { reason: "quota" }),
		]);
		expect(spent[1]?.state).toEqual({
			kind: "quota",
			resetsAt: "2026-10-24T18:00:00.000Z",
		});
		expect(spent[0]?.state).toEqual({ kind: "thinking" });
	});

	it("does not ask the user for a task a role approves, and seats a single agent with no tasks", () => {
		const page = task("Build the page", "frontend_developer");
		const dev = agent("frontend_developer", page.id);
		const byLead = roster([
			page.created,
			dev.created,
			dev.on("agent.thinking.ended"),
			page.to("submitted"),
			event("approval.requested", { approver: "lead" }, { taskId: page.id }),
			event("run.paused", { reason: "approval" }),
		]);
		expect(byLead[0]?.state).toEqual({ kind: "idle" });

		const solo = agent("assistant", "");
		const rows = rosterOf(
			applyAll(RUN, EMPTY_TEAM_VIEW, [
				event(
					"agent.created",
					{
						roleId: "assistant",
						providerId: "groq",
						modelId: "m",
					},
					{ agentId: solo.id },
				),
			]),
		);
		expect(rows).toEqual([
			expect.objectContaining({ roleId: "assistant", done: 0, total: 0 }),
		]);
		expect(rows[0]?.now).toBeUndefined();
	});

	it("adds up the tokens and calls of every agent of a role (ADR-090)", () => {
		const first = task("Draft", "writer");
		const second = task("Edit", "writer");
		const a = agent("writer", first.id);
		const b = agent("writer", second.id);
		const usage = (x: typeof a, prompt: number) =>
			x.on("agent.thinking.ended", { usage: { prompt, completion: 100 } });
		const [writer] = roster([
			first.created,
			second.created,
			a.created,
			usage(a, 1_000),
			b.created,
			usage(b, 2_000),
			usage(b, 3_000),
		]);
		expect(writer?.used).toEqual({ tokens: 6_300, calls: 3 });
		// The share follows the latest agent's latest call.
		expect(writer?.agent?.usage?.last.prompt).toBe(3_000);
		const [quiet] = roster([first.created, a.created]);
		expect(quiet?.used).toBeUndefined();
	});

	it("writes a role id as words", () => {
		expect(roleWords("frontend_developer")).toBe("Frontend developer");
		expect(roleWords("qa")).toBe("Qa");
		expect(roleWords("seo-writer")).toBe("Seo writer");
	});
});
