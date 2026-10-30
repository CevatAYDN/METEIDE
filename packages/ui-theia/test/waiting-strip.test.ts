import type { MeteEvent } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotMerged } from "../src/application/merge-waits.js";
import { QuestionList } from "../src/application/question-list.js";
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
	onShowFiles: () => {},
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

	it("offers the files of a task that waits in a worktree, and nothing when it has none (ADR-132)", () => {
		const asked = (payload: object) =>
			strip([created, event("approval.requested", payload, TASK), paused]);
		expect(asked({ approver: "human", worktree: "/w/r/t" })).toContain(
			"Show files",
		);
		expect(asked({ approver: "human" })).not.toContain("Show files");
	});

	it("puts the questions a task asks the human before its work on its card, with the answer that lifts them (ADR-142)", () => {
		const out = strip([
			created,
			event(
				"task.clarification.requested",
				// A model often numbers or bullets its questions; the list shows each once, unmarked.
				{ toRoleId: "human", question: "1. Which city?\n- Which prices?" },
				TASK,
			),
			event(
				"task.status.changed",
				{ from: "in_progress", to: "blocked" },
				TASK,
			),
			paused,
		]);
		expect(out).toContain("QA asks you before “Audit it”");
		expect(out).toContain("<li>Which city?</li><li>Which prices?</li>");
		expect(out).toContain("Answer…");
		expect(out).toContain(">Go on without answers<");
		expect(out).not.toContain("is blocked on");
	});

	it("offers each question's likely answers as buttons that fill in the answer (ADR-148)", () => {
		const out = strip([
			created,
			event(
				"task.clarification.requested",
				{ toRoleId: "human", question: "Which city? [Ankara | Izmir]" },
				TASK,
			),
			event(
				"task.status.changed",
				{ from: "in_progress", to: "blocked" },
				TASK,
			),
			paused,
		]);
		expect(out).toContain("<li>Which city?<span");
		expect(out).toContain(
			'<button type="button" class="mete-chip" aria-label="Answer “Which city?” with Ankara">Ankara</button>',
		);
		expect(out).toContain('aria-label="Answer “Which city?” with Izmir"');
		expect(out).not.toContain("[Ankara");
	});

	it("hands a clicked option to the card with its question, to fill in the answer (ADR-148)", () => {
		const picks: string[] = [];
		const list = QuestionList({
			questions: [{ text: "Which city?", options: ["Ankara", "Izmir"] }],
			onPick: (q, o) => picks.push(`${q} ${o}`),
		});
		const options = list.props.children[0].props.children[1];
		const buttons = options.type(options.props).props.children;
		buttons[1].props.onClick();
		expect(picks).toEqual(["Which city? Izmir"]);
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

	it("says the run waits, with Resume and no allow hint, when no task asks the human and no ask has arrived (ADR-121)", () => {
		const out = strip([created, paused]);
		expect(out).toContain("The run waits for you.");
		expect(out).toContain(">Resume<");
		expect(out).not.toContain("Allow the action once");
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

	it("names on Always allow the pattern it writes (ADR-158)", () => {
		const out = renderToStaticMarkup(
			createElement(RunWaits, {
				asked: {
					action: "shell.exec",
					capability: "shell.exec@1",
					adapterId: "tools",
					command: "npm test src/a.test.ts",
				},
				onResume: () => {},
			}),
		);
		expect(out).toContain(">Always allow npm test *<");
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

	it("says a task whose merge did not land, git's cause and the files in the way, with Try the merge again in place of Resume (ADR-156)", () => {
		const approved = event(
			"task.status.changed",
			{ from: "submitted", to: "approved" },
			TASK,
		);
		const failed = (payload: object) =>
			strip([
				created,
				approved,
				event(
					"task.merge.failed",
					{ branch: `mete/${RUN}/${TASK}`, ...payload },
					TASK,
				),
				paused,
			]);
		const out = failed({
			code: "merge_conflict",
			message: "merging README.md conflicts with the workspace",
			paths: ["README.md", "docs/a.md"],
		});
		expect(out).toContain('data-tone="bad"');
		expect(out).toContain("Not merged<");
		expect(out).toContain("“Audit it” did not merge");
		expect(out).toContain("merging README.md conflicts with the workspace");
		expect(out).toContain(
			'Commit or move your own changes to <span class="mete-mono">README.md, docs/a.md</span>, then try the merge again.',
		);
		expect(out).toContain(">Try the merge again<");
		expect(out).toContain('<span class="mete-count">1</span>');
		for (const absent of [
			"The run waits for you.",
			">Resume<",
			"Allow the action once",
			">Approve<",
			"Revise…",
		])
			expect(out).not.toContain(absent);
		// An io failure names no files.
		expect(failed({ code: "io", message: "git merge failed" })).toContain(
			"Commit or move your own uncommitted changes in this folder, then try the merge again.",
		);
	});

	it("tries the merge again by approving the task (ADR-156)", () => {
		const approved: string[] = [];
		const card = NotMerged({
			task: {
				id: TASK,
				title: "Audit it",
				roleId: "qa",
				dependsOn: [],
				status: "approved",
				merge: { message: "git merge failed" },
			},
			onApprove: () => approved.push(TASK),
		});
		const actions = card.props.children.at(-1);
		actions.props.children.props.onClick();
		expect(approved).toEqual([TASK]);
	});

	it("draws nothing while the run is not paused for approval", () => {
		const asked = event("approval.requested", { approver: "human" }, TASK);
		expect(strip([created, asked])).toBe("");
		expect(strip([created, asked, paused, event("run.resumed", {})])).toBe("");
		expect(strip([created, event("run.paused", { reason: "quota" })])).toBe("");
	});
});
