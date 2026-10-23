import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	type Effect,
	effectsOf,
	type Frame,
} from "../../src/domain/effects.js";
import { layoutOf } from "../../src/domain/layout.js";
import { sceneOf } from "../../src/domain/scene.js";
import {
	applyAll,
	EMPTY_TEAM_VIEW,
	type TeamView,
} from "../../src/domain/team-view.js";

// The effects of live events, from the room before each event to the room after it.

const RUN = crypto.randomUUID();
const TASK = crypto.randomUUID();
const DEV = crypto.randomUUID();
const LEAD = crypto.randomUUID();

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

const frame = (view: TeamView): Frame => ({
	view,
	layout: layoutOf(sceneOf(view)),
});

// Applies `e` to `view` and returns its effects.
const play = (view: TeamView, e: MeteEvent) => {
	const after = applyAll(RUN, view, [e]);
	return { effects: effectsOf(e, frame(view), frame(after)), after };
};

const created = event(
	"task.created",
	{ title: "Build", roleId: "dev", dependsOn: [] },
	{ taskId: TASK },
);
const agent = (id: string, roleId: string, taskId?: string) =>
	event(
		"agent.created",
		{ roleId, providerId: "groq", modelId: "m" },
		{ agentId: id, ...(taskId ? { taskId } : {}) },
	);
const kinds = (effects: Effect[]) =>
	effects.map((x) =>
		x.kind === "move" ? `move ${x.target.split(":")[0]}` : x.kind,
	);

describe("the studio's effects", () => {
	it("drops a new note onto the board from above it", () => {
		const { effects } = play(EMPTY_TEAM_VIEW, created);
		expect(effects).toEqual([
			expect.objectContaining({ kind: "move", target: `note:${TASK}` }),
		]);
		const move = effects[0];
		expect(move?.kind === "move" && move.from.y < move.to.y).toBe(true);
	});

	it("moves an approved task's note to Done with a sparkle, and bursts at its approver", () => {
		const start = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created,
			agent(LEAD, "lead"),
			event("task.assigned", { agentId: DEV }, { taskId: TASK }),
			agent(DEV, "dev", TASK),
			event("approval.requested", { approver: "lead" }, { taskId: TASK }),
		]);
		const { effects } = play(
			start,
			event(
				"task.status.changed",
				{ from: "submitted", to: "approved" },
				{ taskId: TASK },
			),
		);
		expect(kinds(effects)).toEqual(["move note", "burst", "burst"]);
	});

	it("sends an envelope back with a mark when changes are asked, and marks a blocked task", () => {
		const start = applyAll(RUN, EMPTY_TEAM_VIEW, [
			created,
			agent(LEAD, "lead"),
			event("task.assigned", { agentId: DEV }, { taskId: TASK }),
			agent(DEV, "dev", TASK),
			event("approval.requested", { approver: "lead" }, { taskId: TASK }),
			event(
				"task.status.changed",
				{ from: "todo", to: "submitted" },
				{ taskId: TASK },
			),
		]);
		const back = play(
			start,
			event(
				"task.status.changed",
				{ from: "submitted", to: "changes_requested" },
				{ taskId: TASK },
			),
		);
		expect(back.effects).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "move", target: "envelope" }),
				expect.objectContaining({ kind: "mark", text: "!", colour: "warn" }),
			]),
		);
		const blocked = play(
			start,
			event(
				"task.status.changed",
				{ from: "submitted", to: "blocked" },
				{ taskId: TASK },
			),
		);
		expect(blocked.effects.filter((x) => x.kind === "mark")).toHaveLength(2);
	});

	it("walks an agent to the coffee corner with a nap when its run pauses for its spent quota", () => {
		const start = applyAll(RUN, EMPTY_TEAM_VIEW, [
			agent(DEV, "dev"),
			event(
				"quota.exhausted",
				{
					providerId: "groq",
					unit: "requests_per_day",
					resetsAt: "2026-10-24T00:00:00.000Z",
				},
				{ runId: undefined },
			),
		]);
		const { effects } = play(start, event("run.paused", { reason: "quota" }));
		expect(kinds(effects)).toEqual(["move head", "mark"]);
	});

	it("leaves a tool's work to its monitor and the network pause to the room's state, and celebrates the end", () => {
		const start = applyAll(RUN, EMPTY_TEAM_VIEW, [agent(DEV, "dev")]);
		const tool = play(
			start,
			event(
				"agent.tool.called",
				{ capability: "fs.read@1", adapterId: "tools-fs" },
				{ agentId: DEV },
			),
		);
		expect(tool.effects).toEqual([]);
		expect(
			play(start, event("run.paused", { reason: "network" })).effects,
		).toEqual([]);
		expect(
			kinds(play(start, event("run.completed", { summary: "s" })).effects),
		).toEqual(["burst", "jump"]);
	});
});
