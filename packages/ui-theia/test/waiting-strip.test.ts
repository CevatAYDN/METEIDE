import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WaitingStrip } from "../src/application/waiting-strip.js";

// The Team panel's Waiting for you strip (ADR-091) over a view the real fold built.

const RUN = crypto.randomUUID();
const TASK = crypto.randomUUID();

const event = (type: string, payload: object, taskId?: string): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-24T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: RUN,
		...(taskId ? { taskId } : {}),
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const created = event(
	"task.created",
	{ title: "Audit it", roleId: "qa", dependsOn: [] },
	TASK,
);
const paused = event("run.paused", { reason: "approval" });
const controls = {
	onApprove: () => {},
	onRevise: () => {},
	onResume: () => {},
	onOpen: () => {},
};
const strip = (events: MeteEvent[]) =>
	renderToStaticMarkup(
		createElement(WaitingStrip, {
			view: applyAll(RUN, EMPTY_TEAM_VIEW, events),
			names: { qa: "QA" },
			controls,
		}),
	);

describe("the Waiting for you strip", () => {
	it("names the member whose task waits for the human, with its report, Approve and Revise", () => {
		const out = strip([
			created,
			event(
				"artifact.created",
				{
					artifactId: crypto.randomUUID(),
					type: "report@1",
					path: ".mete/artifacts/r/audit.md",
				},
				TASK,
			),
			event("approval.requested", { approver: "human" }, TASK),
			paused,
		]);
		expect(out).toContain("QA asks you to approve “Audit it”");
		expect(out).toContain('aria-label="Open the report of Audit it"');
		expect(out).toContain(">audit.md<");
		expect(out).toContain(">Approve<");
		expect(out).toContain("Revise…");
		expect(out).toContain('name="feedback" required=""');
		expect(out).not.toContain("The run waits for you.");
	});

	it("says the run waits, with Resume, when no task asks the human", () => {
		const out = strip([created, paused]);
		expect(out).toContain("The run waits for you.");
		expect(out).toContain(">Resume<");
		expect(out).not.toContain(">Approve<");
	});

	it("draws nothing while the run is not paused for approval", () => {
		const asked = event("approval.requested", { approver: "human" }, TASK);
		expect(strip([created, asked])).toBe("");
		expect(strip([created, asked, paused, event("run.resumed", {})])).toBe("");
		expect(strip([created, event("run.paused", { reason: "quota" })])).toBe("");
	});
});
