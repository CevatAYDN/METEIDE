import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, inboxLink, runCommand, startRun, test } from "./launch.js";

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

/** The panel's answer, so a phrase the Activity feed also prints is read once. */
const answer = (page: Page) => page.getByRole("region", { name: "Answer" });

/** The Team panel that holds the phrase, so a Home button of the same name is never clicked. */
const board = (page: Page, phrase: RegExp) =>
	page.locator(".mete-panel").filter({ hasText: phrase });

/** The Team panel's center column, whose strip names a wait; the rail's feed says it too (ADR-119). */
const center = (page: Page) => page.locator(".mete-run-center");

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
		await startRun(page, { goal: GOAL, team: /duo/i });
		const asks = /asks you to approve “Write the summary”/;
		await expect(page.getByText(asks)).toBeVisible({ timeout: 90_000 });

		// The inbox counts the run and its goal opens the run's panel.
		await runCommand(page, "METE: Show what waits for you");
		await expect(page.getByText("1 waiting for you")).toBeVisible({
			timeout: 60_000,
		});
		await expect(inboxLink(page, GOAL)).toBeVisible({ timeout: 60_000 });
		await inboxLink(page, GOAL).click();
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
		await startRun(page, { goal: GOAL, team: /triage/i });
		const blocked = /is blocked on “Write the report”/;
		await expect(center(page).getByText(blocked)).toBeVisible({
			timeout: 90_000,
		});

		// The inbox names the same run; its goal opens the panel where the block is answered.
		await runCommand(page, "METE: Show what waits for you");
		await expect(inboxLink(page, GOAL)).toBeVisible({ timeout: 60_000 });
		await inboxLink(page, GOAL).click();
		await expect(center(page).getByText(blocked)).toBeVisible({
			timeout: 60_000,
		});

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

// The workspace-reading flow: a single agent reads a file and greps the folder, so a packaged run
// proves the daemon, its SQLite database and the ripgrep the tools carry all work from the package
// (ADR-124).
const TOKEN = "METE_E2E_TOKEN";

// The calls a packaged run makes: read one file, then grep the folder for the token (ADR-124).
const READ_SCRIPT = {
	turns: [
		[
			{
				type: "tool-call",
				id: "read",
				name: "fs_read",
				args: { path: "README.md" },
			},
			{
				type: "tool-call",
				id: "grep",
				name: "fs_grep",
				args: { pattern: TOKEN },
			},
			{
				type: "finish",
				reason: "tool-calls",
				usage: { prompt: 12, completion: 4 },
			},
		],
		say(`The workspace mentions ${TOKEN}.`),
	],
};

test.describe("a run that reads and searches the workspace", () => {
	test.use({
		files: {
			"README.md": `# Release notes\n\nThe token is ${TOKEN}.\n`,
			"notes/guide.md": `${TOKEN} appears here too.\n`,
		},
		script: READ_SCRIPT,
	});

	test("runs fs_read and fs_grep, writes SQLite and answers", async ({
		mete,
	}) => {
		const { page, dir } = mete;
		await startRun(page, { goal: "find the token", team: /single agent/i });

		// The Activity feed names the capability of every finished call.
		await expect(page.getByText(/uses fs\.read@1/)).toBeVisible({
			timeout: 90_000,
		});
		await expect(page.getByText(/uses fs\.grep@1/)).toBeVisible({
			timeout: 60_000,
		});
		await expect(
			answer(page).getByText(`The workspace mentions ${TOKEN}.`),
		).toBeVisible({ timeout: 60_000 });
		// The center's steps name each call with its first argument (ADR-125).
		await expect(page.getByText("fs_read README.md")).toBeVisible();

		// The daemon wrote the run to the workspace's database, which starts as a bare schema.
		const db = join(dir, ".mete", "mete.db");
		await expect.poll(() => existsSync(db), { timeout: 30_000 }).toBe(true);
		expect(readFileSync(db).subarray(0, 15).toString("latin1")).toBe(
			"SQLite format 3",
		);
		const written = [db, `${db}-wal`]
			.filter((file) => existsSync(file))
			.some((file) => readFileSync(file).includes("find the token"));
		expect(written).toBe(true);
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
		await startRun(page, { goal: GOAL, team: /pair/i });

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
