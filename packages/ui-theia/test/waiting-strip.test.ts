import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllowActions, RunWaits } from "../src/application/run-waits.js";
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

	it("names a blocked task and offers the instruction that lifts it (docs/07)", () => {
		const out = strip([
			created,
			event(
				"task.status.changed",
				{ from: "in_progress", to: "blocked" },
				TASK,
			),
			paused,
		]);
		expect(out).toContain("QA is blocked on “Audit it”");
		expect(out).toContain("It goes on when you answer");
		expect(out).toContain(">Go on<");
		expect(out).toContain("Give an instruction…");
		expect(out).toContain('name="feedback" required=""');
		expect(out).not.toContain("asks you to approve");
		expect(out).not.toContain("The run waits for you.");
	});

	it("says the run waits, with Resume and the 3-answer hint, when no task asks the human and no ask has arrived", () => {
		const out = strip([created, paused]);
		expect(out).toContain("The run waits for you.");
		expect(out).toContain(">Resume<");
		expect(out).toContain(
			"Allow the action once, for the rest of this run, or always in .mete/policy.yaml.",
		);
		expect(out).not.toContain(">Approve<");
		expect(out).not.toContain("Allow once");
	});

	it("shows the policy ask line and three buttons when asked has an unmasked command", () => {
		const out = strip([
			created,
			paused,
			event("policy.asked", {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test",
				rule: "shell_allow",
			}),
		]);
		expect(out).toContain("The run waits for you.");
		expect(out).toContain("asks shell.exec: npm test");
		expect(out).toContain(">Allow once<");
		expect(out).toContain(">Allow for this run<");
		expect(out).toContain(">Always allow<");
		expect(out).toContain(
			"Allow the action once, for the rest of this run, or always in .mete/policy.yaml.",
		);
		expect(out).not.toContain(">Resume<");
	});

	it("hides Always allow when the command was masked by secrets", () => {
		const out = strip([
			created,
			paused,
			event("policy.asked", {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test --token=[SECRET:abcd1234]",
				rule: "shell_allow",
			}),
		]);
		expect(out).toContain("The run waits for you.");
		expect(out).toContain(
			"asks shell.exec: npm test --token=[SECRET:abcd1234]",
		);
		expect(out).toContain(">Allow once<");
		expect(out).toContain(">Allow for this run<");
		expect(out).not.toContain("Always allow");
		expect(out).not.toContain(">Resume<");
	});

	it("renders the engine error message on the card for a refused allow", () => {
		const out = renderToStaticMarkup(
			createElement(RunWaits, {
				asked: {
					action: "shell.exec",
					capability: "shell.exec@1",
					adapterId: "tools",
					command: "npm test",
				},
				onResume: () => {},
				initialError:
					"Always allow takes a command whose text was not masked; allow it once or for the run",
			}),
		);
		expect(out).toContain(
			"Always allow takes a command whose text was not masked; allow it once or for the run",
		);
		expect(out).toContain('style="color:var(--theia-errorForeground)"');
	});

	it("dispatches allow actions when scope buttons are clicked", () => {
		const scopes: string[] = [];
		const resumed: boolean[] = [];
		const tree = AllowActions({
			asked: {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "tools",
				command: "npm test",
			},
			onAct: (s) => scopes.push(s),
			onResume: () => resumed.push(true),
		});
		const buttons = tree.props.children.props.children;
		expect(buttons).toHaveLength(3);
		buttons[0].props.onClick();
		buttons[1].props.onClick();
		buttons[2].props.onClick();
		expect(scopes).toEqual(["once", "run", "always"]);
		expect(resumed).toHaveLength(0);

		const resumeTree = AllowActions({
			onAct: (s) => scopes.push(s),
			onResume: () => resumed.push(true),
		});
		resumeTree.props.children.props.onClick();
		expect(resumed).toEqual([true]);
	});

	it("counts the waiting tasks in its title and tones each card by its wait, the run's own card uncounted (ADR-119)", () => {
		const other = crypto.randomUUID();
		const out = strip([
			created,
			event(
				"task.created",
				{ title: "Fix it", roleId: "qa", dependsOn: [] },
				other,
			),
			event("approval.requested", { approver: "human" }, TASK),
			event(
				"task.status.changed",
				{ from: "in_progress", to: "blocked" },
				other,
			),
			paused,
		]);
		expect(out).toContain('<span class="mete-count">2</span>');
		expect(out.match(/class="mete-wait-card"/g)).toHaveLength(2);
		expect(out).toMatch(
			/data-tone="warn"[\s\S]*?Review<[\s\S]*?asks you to approve/,
		);
		expect(out).toMatch(/data-tone="bad"[\s\S]*?Blocked<[\s\S]*?is blocked on/);
		const run = strip([created, paused]);
		expect(run).toContain("Waiting for you");
		expect(run).not.toContain("mete-count");
	});

	it("draws nothing while the run is not paused for approval", () => {
		const asked = event("approval.requested", { approver: "human" }, TASK);
		expect(strip([created, asked])).toBe("");
		expect(strip([created, asked, paused, event("run.resumed", {})])).toBe("");
		expect(strip([created, event("run.paused", { reason: "quota" })])).toBe("");
	});
});
