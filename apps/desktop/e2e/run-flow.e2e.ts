import type { Page } from "@playwright/test";
import { expect, runCommand, test } from "./launch.js";

// docs/15's desktop flows with the real daemon and the real panels, and a model that answers from a
// file (ADR-111): what a user sees when a task waits for approval, blocks, and goes on. No provider
// key and no network are involved; the workspace's own team files decide the flow.

const GOAL = "write the release notes";

const say = (text: string) => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 12, completion: 4 } },
];

const DUO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0, description: Two notes }
pattern: pipeline
roles:
  - { id: writer, name: Writer, goal: Write short notes, tier: fast, capabilities: [] }
tasks:
  - { id: notes, role: writer, title: Take notes }
  - { id: summary, role: writer, title: Write the summary, context: [notes] }
policies: { human_checkpoints: [summary] }
`;

const TRIAGE = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: triage, name: Triage, version: 1.0.0, description: "One report, checked" }
pattern: single
roles:
  - { id: writer, name: Writer, goal: Write a short report, tier: fast, capabilities: [] }
tasks:
  - id: report
    role: writer
    title: Write the report
    guardrail: { schema: research-report@1, max_retries: 2 }
policies: { human_checkpoints: [report] }
`;

const REPORT =
	'{"title":"Release notes","summary":"The release ships.","findings":[{"claim":"It ships.","sourceIds":["s1"]}],"sources":[{"id":"s1","url":"https://example.com/release","title":"Release"}]}';

// Two tasks and no checkpoint, so the only thing that stops the run is the provider's quota.
const PAIR = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: pair, name: Pair, version: 1.0.0, description: Two notes }
pattern: pipeline
roles:
  - { id: writer, name: Writer, goal: Write short notes, tier: fast, capabilities: [] }
tasks:
  - { id: notes, role: writer, title: Take notes }
  - { id: summary, role: writer, title: Write the summary, context: [notes] }
`;

/** Starts a run from the composer with the team's radio and the test's goal. */
const startRun = async (page: Page, team: RegExp) => {
	await runCommand(page, "METE: Start run");
	const goal = page.locator("textarea.mete-field");
	await expect(goal).toBeVisible({ timeout: 60_000 });
	const radio = page.getByRole("radio", { name: team });
	await expect(radio).toBeVisible({ timeout: 60_000 });
	await goal.fill(GOAL);
	await radio.check();
	await page.getByRole("button", { name: "Start run" }).click();
};

/** The Team panel that holds the phrase, so a Home button of the same name is never clicked. */
const board = (page: Page, phrase: RegExp) =>
	page.locator(".mete-panel").filter({ hasText: phrase });

/** The Home inbox's row for this run, whose goal opens it in the Team panel (ADR-110). */
const inboxLink = (page: Page) =>
	page
		.locator('section[aria-label="Waiting for you"]')
		.filter({ has: page.getByTitle("Open in the team panel") })
		.getByTitle("Open in the team panel")
		.filter({ hasText: GOAL });

/** Opens the Quota dashboard and checks the scripted provider's spent unit: one request of one. */
const expectSpentUnit = async (page: Page) => {
	await runCommand(page, "METE: Open quota dashboard");
	const unit = page
		.locator(".mete-panel")
		.filter({ hasText: "requests_per_minute" })
		.locator("tr")
		.filter({ hasText: "scripted" });
	await expect(unit).toBeVisible({ timeout: 60_000 });
	await expect(unit).toContainText("scripted");
	await expect(unit).toContainText("requests_per_minute");
	await expect(unit.getByRole("cell", { name: "1", exact: true })).toHaveCount(
		2,
	);
};

test.describe("a run that waits for approval", () => {
	test.use({
		files: { ".mete/teams/duo.yaml": DUO },
		script: { turns: [say("three notes"), say("one summary")] },
	});

	test("is answered from the Home inbox and completes", async ({ mete }) => {
		const { page } = mete;
		await startRun(page, /duo/i);
		const asks = /asks you to approve “Write the summary”/;
		await expect(page.getByText(asks)).toBeVisible({ timeout: 90_000 });

		// The inbox counts the run and its goal opens the run's panel.
		await runCommand(page, "METE: Show what waits for you");
		await expect(page.getByText("1 waiting for you")).toBeVisible({
			timeout: 60_000,
		});
		await expect(inboxLink(page)).toBeVisible({ timeout: 60_000 });
		await inboxLink(page).click();
		await expect(page.getByText(asks)).toBeVisible({ timeout: 60_000 });

		// The goal's link opened the Team panel; its own Approve answers the run (ADR-048), and the
		// panel took focus when it opened, so the first click on the button is delivered (ADR-112).
		await board(page, asks).getByRole("button", { name: "Approve" }).click();
		await expect(page.getByText("1 waiting for you")).toHaveCount(0, {
			timeout: 60_000,
		});
		await expect(
			page.locator('section[aria-label="Runs"]').getByText("Done"),
		).toBeVisible({ timeout: 60_000 });
	});
});

test.describe("a run blocked by its guardrail", () => {
	test.use({
		files: { ".mete/teams/triage.yaml": TRIAGE },
		// The guardrail's two repairs fail, then the human's instruction gets the report.
		script: {
			turns: [say("not a report"), say("still not"), say("no"), say(REPORT)],
		},
	});

	test("takes an instruction, asks for approval and completes", async ({
		mete,
	}) => {
		const { page } = mete;
		await startRun(page, /triage/i);
		const blocked = /is blocked on “Write the report”/;
		await expect(page.getByText(blocked)).toBeVisible({ timeout: 90_000 });

		// The inbox names the same run; its goal opens the panel where the block is answered.
		await runCommand(page, "METE: Show what waits for you");
		await expect(inboxLink(page)).toBeVisible({ timeout: 60_000 });
		await inboxLink(page).click();
		await expect(page.getByText(blocked)).toBeVisible({ timeout: 60_000 });

		await page.getByText("Give an instruction…").click();
		await page
			.getByRole("textbox", { name: "What should it do?" })
			.fill("Write the report as JSON with one finding and one source.");
		await page.getByRole("button", { name: "Send the instruction" }).click();

		const asks = /asks you to approve “Write the report”/;
		await expect(page.getByText(asks)).toBeVisible({ timeout: 60_000 });
		await board(page, asks).getByRole("button", { name: "Approve" }).click();
		await expect(
			page.locator('section[aria-label="Runs"]').getByText("Done"),
		).toBeVisible({ timeout: 60_000 });
	});
});

test.describe("a run whose provider quota is spent", () => {
	test.use({
		files: { ".mete/teams/pair.yaml": PAIR },
		// One request a day: the second call finds the unit spent until the fixed reset, so the run
		// pauses (a sliding minute would make the reservation wait instead, docs/09 Scheduler).
		script: {
			turns: [say("three notes"), say("one summary")],
			quota: { limit: 1, reset: "fixed_daily" },
		},
	});

	test("pauses, names the spent provider and takes a resume", async ({
		mete,
	}) => {
		const { page } = mete;
		await startRun(page, /pair/i);

		// Home's Runs row says why each provider cannot help (ADR-050) and offers ADR-059's resume.
		const runs = page.locator('section[aria-label="Runs"]');
		await expect(
			runs.getByText(/scripted: its free quota is used up until/),
		).toBeVisible({ timeout: 90_000 });
		await expect(runs.getByText("Paused")).toBeVisible({ timeout: 60_000 });
		const resume = runs.getByRole("button", { name: "Resume now" });
		await expect(resume).toBeVisible({ timeout: 60_000 });

		// The resume goes on at once (ADR-059) and pauses again while the unit is still spent.
		await resume.click();
		// Theia puts a notification's text in a toast and in a live region for screen readers.
		await expect(page.getByText("Resumed.").first()).toBeVisible({
			timeout: 60_000,
		});
		await expect(runs.getByText("Paused")).toBeVisible({ timeout: 60_000 });

		await expectSpentUnit(page);
	});
});
