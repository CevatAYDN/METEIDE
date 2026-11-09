import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme, pick, replaceFile } from "./ide-interactions.js";
import { expect, type Launch, runCommand, startRun, test } from "./launch.js";

const TEAM = `# keep this team comment
apiVersion: mete/v2
kind: TeamTemplate
metadata: { id: recovery, name: Recovery team, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: writer, name: Writer, goal: Write a fixture, tier: coder, needs: [tool_calling], capabilities: [fs.write@1] }
  - { id: reviewer, name: Reviewer, goal: Review a fixture, tier: reasoning, capabilities: [] }
tasks:
  - { id: write, role: writer, title: Write result }
  - { id: review, role: reviewer, title: Review result, context: [write] }
`;
const SKILL =
	"---\nname: recovery-skill\ndescription: Review a test change\n---\nRead the evidence before proposing a change.\n";
const SOURCE = ".mete/skills/recovery-skill/SKILL.md";
const POLICY =
	"# keep this policy comment\nautonomy: 2\nbudget: { max_hours: 3 }\n";
const say = (text: string) => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 8, completion: 4 } },
];

test.use({
	files: {
		".gitattributes": "* text=auto eol=lf\n",
		".mete/teams/recovery.yaml": TEAM,
		".mete/policy.yaml": POLICY,
		[SOURCE]: SKILL,
	},
	commit: true,
	script: {
		turns: [
			[
				{
					type: "tool-call",
					id: "write-result",
					name: "fs_write",
					args: { path: "result.txt", content: "Human-approved result\n" },
				},
				{
					type: "finish",
					reason: "tool-calls",
					usage: { prompt: 8, completion: 4 },
				},
			],
			say("The result file is written."),
			say("The fixture is reviewed."),
		],
	},
});

const settings = (page: Page) => page.locator(".mete-settings");
const team = (page: Page) => page.locator(".mete-team");
const skillRow = (page: Page) =>
	page.locator(".mete-skills-row").filter({
		has: page.getByText("recovery-skill/SKILL.md", { exact: true }),
	});
const tab = (page: Page, name: string) =>
	page.locator(".lm-TabBar-tabLabel").filter({ hasText: name });
const taskStep = (page: Page, title: string) =>
	team(page)
		.getByRole("button")
		.filter({
			has: page.getByText(title, { exact: true }),
		});

const openTeam = async (page: Page) => {
	await runCommand(page, "METE: Edit team");
	await pick(page, "Recovery team");
	await expect(team(page)).toBeVisible();
};

const expectNoModelCalls = (dir: string) => {
	const db = new DatabaseSync(join(dir, ".mete", "mete.db"), {
		readOnly: true,
	});
	try {
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM model_calls").get(),
		).toEqual({ count: 0 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM runs").get()).toEqual({
			count: 0,
		});
	} finally {
		db.close();
	}
};

const capture = async (page: Page, prefix: string) => {
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const width of [1366, 700]) {
			await page.setViewportSize({ width, height: 900 });
			const root = page
				.locator(".mete-team:visible, .mete-settings:visible")
				.first();
			await expect(root).toBeVisible();
			expect(
				await root.evaluate(
					(element) => element.scrollWidth <= element.clientWidth + 1,
				),
			).toBe(true);
			expect(await meteViolations(page)).toEqual([]);
			await page.screenshot({
				path: test
					.info()
					.outputPath(`${prefix}-${theme.split(" ")[0]}-${width}.png`),
			});
		}
	}
	await page.setViewportSize({ width: 1366, height: 900 });
};

const editTeam = async (page: Page) => {
	await openTeam(page);
	await team(page)
		.getByLabel("Team name", { exact: true })
		.fill("Recovery team draft");
	await taskStep(page, "Review result").click();
	await expect(
		team(page).getByRole("tab", { name: "Tasks", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await taskStep(page, "Write result").click();
	await expect(
		team(page)
			.getByRole("tabpanel", { name: "Tasks", exact: true })
			.getByRole("textbox", { name: "Title", exact: true }),
	).toHaveValue("Write result");
	const member = team(page).getByRole("tab", { name: "Member", exact: true });
	await member.click();
	await team(page)
		.getByRole("textbox", { name: "Goal", exact: true })
		.fill("A retained member goal");
	await member.press("ArrowRight");
	await expect(
		team(page).getByRole("tab", { name: "Tasks", exact: true }),
	).toBeFocused();
	await team(page)
		.getByRole("tab", { name: "Tasks", exact: true })
		.press("ArrowLeft");
	await expect(
		team(page).getByRole("textbox", { name: "Goal", exact: true }),
	).toHaveValue("A retained member goal");
};

const editPermissions = async ({ page, dir }: Launch) => {
	await team(page)
		.getByRole("button", { name: "Project permissions", exact: true })
		.click();
	await expect(
		settings(page).getByRole("heading", {
			name: "Permissions and approvals",
			exact: true,
		}),
	).toBeVisible();
	const ask = settings(page).getByRole("group", {
		name: "Actions that ask first",
		exact: true,
	});
	await ask.getByLabel("Rule source", { exact: true }).selectOption("custom");
	await ask.getByLabel("Write files", { exact: true }).check();
	expect(readFileSync(join(dir, ".mete", "policy.yaml"), "utf8")).toBe(POLICY);
	await runCommand(page, "METE: Open skills");
	await runCommand(page, "METE: Open permissions");
	await expect(ask.getByLabel("Write files", { exact: true })).toBeChecked();
	await settings(page)
		.getByRole("button", { name: "Save changes", exact: true })
		.click();
	await expect
		.poll(() => readFileSync(join(dir, ".mete", "policy.yaml"), "utf8"))
		.toContain("fs.write");
	expect(readFileSync(join(dir, ".mete", "policy.yaml"), "utf8")).toContain(
		"# keep this policy comment",
	);
	await capture(page, "permissions");
};

const editLearning = async ({ page, dir }: Launch) => {
	await tab(page, "Edit team").click();
	await expect(team(page).getByLabel("Team name", { exact: true })).toHaveValue(
		"Recovery team draft",
	);
	await team(page).locator(".mete-team-learning > summary").click();
	const lesson = team(page).getByLabel(
		"Write result (Writer): write a lesson after approval",
		{ exact: true },
	);
	await lesson.check();
	await team(page).getByRole("button", { name: "Save", exact: true }).click();
	const file = join(dir, ".mete", "teams", "recovery.yaml");
	await expect
		.poll(() => readFileSync(file, "utf8"))
		.toContain("write_lessons: true");
	await lesson.uncheck();
	await team(page).getByRole("button", { name: "Save", exact: true }).click();
	await expect
		.poll(() => readFileSync(file, "utf8"))
		.not.toContain("write_lessons");
	expect(readFileSync(file, "utf8")).toContain("# keep this team comment");
	await capture(page, "team");
	expectNoModelCalls(dir);
};

const runApprovedWrite = async ({ page, dir }: Launch) => {
	await startRun(page, {
		goal: "Write the approved result",
		team: /Recovery team draft/,
	});
	const request = page
		.getByRole("region", { name: "Task decisions", exact: true })
		.getByRole("listitem")
		.filter({
			has: page.getByRole("heading", { name: "Write result", exact: true }),
		});
	await expect(request).toContainText("fs.write", { timeout: 90_000 });
	expect(existsSync(join(dir, "result.txt"))).toBe(false);
	await request
		.getByRole("button", { name: "Allow once", exact: true })
		.click();
	await expect
		.poll(() => existsSync(join(dir, "result.txt")), { timeout: 90_000 })
		.toBe(true);
	expect(readFileSync(join(dir, "result.txt"), "utf8")).toBe(
		"Human-approved result\n",
	);
	await expect(
		page.locator('section[aria-label="Team runs"]').getByText("Done"),
	).toBeVisible({ timeout: 60_000 });
	await page.screenshot({
		path: test.info().outputPath("approved-file-workflow.png"),
	});
};

test("team editing, permissions and a real approval-gated file workflow remain connected", async ({
	mete,
}) => {
	await editTeam(mete.page);
	await editPermissions(mete);
	await editLearning(mete);
	await runApprovedWrite(mete);
});

const approveInitialSkill = async (page: Page) => {
	await runCommand(page, "METE: Open skills");
	await settings(page)
		.getByRole("button", { name: "Discover", exact: true })
		.click();
	const row = skillRow(page);
	await expect(row).toBeVisible({ timeout: 60_000 });
	await row.getByRole("button", { name: "Review", exact: true }).click();
	await settings(page)
		.getByRole("button", { name: "Approve", exact: true })
		.click();
	await expect(row.locator(".mete-skills-row-head > span")).toHaveText(
		"Approved",
		{ timeout: 60_000 },
	);
};

const editSkillSource = async ({ page, dir }: Launch) => {
	const row = skillRow(page);
	await row.getByRole("button", { name: "Edit SKILL.md", exact: true }).click();
	await expect(
		page.locator(".monaco-editor:visible .view-lines").first(),
	).toContainText("Read the evidence");
	const changed = SKILL.replace(
		"Read the evidence",
		"Check the saved evidence",
	);
	await replaceFile(page, changed);
	await expect
		.poll(() => readFileSync(join(dir, SOURCE), "utf8"))
		.toBe(changed);
	return changed;
};

const approveChangedSkill = async (page: Page, changed: string) => {
	const row = skillRow(page);
	await runCommand(page, "METE: Open skills");
	await expect(row.locator(".mete-skills-row-head > span")).toHaveText(
		"Changed",
		{ timeout: 60_000 },
	);
	await expect(
		settings(page).getByRole("button", { name: "Approve", exact: true }),
	).toHaveCount(0);
	await row.getByRole("button", { name: "Review", exact: true }).click();
	await expect(
		settings(page).getByLabel("Masked SKILL.md", { exact: true }),
	).toHaveValue(changed);
	await settings(page)
		.getByRole("button", { name: "Approve", exact: true })
		.click();
	await expect(row.locator(".mete-skills-row-head > span")).toHaveText(
		"Approved",
		{ timeout: 60_000 },
	);
};

const verifySkillRestart = async (mete: Launch) => {
	await mete.restart();
	await runCommand(mete.page, "METE: Open skills");
	await settings(mete.page)
		.getByRole("button", { name: "Discover", exact: true })
		.click();
	await expect(
		skillRow(mete.page).locator(".mete-skills-row-head > span"),
	).toHaveText("Approved", { timeout: 60_000 });
	expectNoModelCalls(mete.dir);
	await mete.page.screenshot({
		path: test.info().outputPath("edited-skill-after-restart.png"),
	});
};

test("edits an approved skill in the real editor and requires review of the new version", async ({
	mete,
}) => {
	await approveInitialSkill(mete.page);
	const changed = await editSkillSource(mete);
	await approveChangedSkill(mete.page, changed);
	await verifySkillRestart(mete);
});
