import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { factsOf, reportOf } from "../src/domain/run-report.js";

// A run's journal section (docs/11, Run reports), from its events alone.

const RUN = "7f0c6f8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
let seq = 0;
const ev = <T extends MeteEvent["type"]>(
	type: T,
	payload: Extract<MeteEvent, { type: T }>["payload"],
) =>
	({
		id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
		ts: "2026-10-28T10:00:00.000Z",
		schema: 1,
		workspaceId: "11111111-1111-4111-8111-111111111111",
		runId: RUN,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const done: MeteEvent[] = [
	ev("run.created", {
		templateId: "page-pair",
		goal: "Build a page\nwith a menu",
	}),
	ev("agent.created", {
		roleId: "writer",
		providerId: "groq",
		modelId: "gpt-oss-120b",
	}),
	ev("agent.model.changed", {
		from: { providerId: "groq", modelId: "gpt-oss-120b" },
		to: { providerId: "nvidia", modelId: "nemotron" },
		reason: "quota",
	}),
	ev("agent.tool.completed", {
		capability: "fs.write@1",
		ok: true,
		durationMs: 4,
	}),
	ev("agent.tool.completed", {
		capability: "fs.write@1",
		ok: true,
		durationMs: 3,
	}),
	ev("agent.tool.completed", {
		capability: "shell.exec@1",
		ok: false,
		durationMs: 9,
		error: { code: "timeout" },
	}),
	ev("checkpoint.created", { kind: "git", ref: "refs/mete/x" }),
	ev("handoff.created", {
		handoffId: "22222222-2222-4222-8222-222222222222",
		files: ["early.md"],
	}),
	ev("run.completed", {
		summary: "Built it.\n## Not a heading of the journal",
	}),
	ev("handoff.created", {
		handoffId: "33333333-3333-4333-8333-333333333333",
		files: ["index.html", "DESIGN.md"],
	}),
];

describe("run report", () => {
	it("names the goal, team, models, calls, failures, checkpoints, files and summary", () => {
		expect(reportOf(RUN, "2026-10-28 13:00", factsOf(done))).toBe(
			[
				"## Build a page",
				"",
				`- Run: ${RUN}, ended 2026-10-28 13:00`,
				"- Team: page-pair",
				"- Status: completed",
				"- Models: groq/gpt-oss-120b, nvidia/nemotron",
				"- Tool calls: fs.write@1 × 2, shell.exec@1",
				"- Failed calls: shell.exec@1 (timeout)",
				"- Checkpoints: 1",
				"- Changed files: `index.html`, `DESIGN.md`",
				"",
				"> Built it.",
				"> ## Not a heading of the journal",
				"",
			].join("\n"),
		);
	});

	it("gives a failed single-agent run its code and no summary", () => {
		const failed = [
			ev("run.created", { templateId: null, goal: "x".repeat(100) }),
			ev("run.failed", { code: "artifact_failed", message: "disk full" }),
		];
		const out = reportOf(RUN, "2026-10-28 13:00", factsOf(failed));
		expect(out).toContain(`## ${"x".repeat(79)}…\n`);
		expect(out).toContain(
			"- Team: single agent\n- Status: failed (artifact_failed)\n",
		);
		expect(out).toContain(
			"- Tool calls: none\n- Checkpoints: 0\n- Changed files: none\n",
		);
		expect(out).not.toContain("disk full");
		expect(out).not.toContain("Failed calls");
	});
});
