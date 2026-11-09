import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Locator, Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, type Launch, runCommand, test } from "./launch.js";

const NAME = "skill-foundation-review-with-a-long-source-label";
const RELATIVE = `.mete/skills/${NAME}/SKILL.md`;
const YAML = "# unrelated workspace settings must survive\nservers: []\n";
const GLOBAL_YAML =
	"# unrelated global settings must survive\nprivacy:\n  allowTraining: false\n";
const SOURCE = [
	"---",
	`name: ${NAME}`,
	"description: Synthetic local review fixture",
	"allowed-tools: informational-only",
	"---",
	"<script>synthetic plaintext, never executable</script>",
	"[synthetic masked marker; no credential]",
	"long-unbroken-source-line-".repeat(12),
	...Array.from(
		{ length: 70 },
		(_, i) => `Review line ${i}: synthetic local instructions.`,
	),
	"END OF FULL PREVIEW",
	"",
].join("\n");
const INVALID =
	"---\nname: invalid-field\ndescription: Invalid fixture\nunsupported: true\n---\nBody.\n";

test.use({
	files: {
		".mete/mcp.yaml": YAML,
	},
	script: {
		turns: [
			[
				{
					type: "text",
					text: "Offline skills fixture; no model call expected",
				},
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const skills = (page: Page) => page.locator(".mete-skills");
const row = (page: Page, scope: string, name = NAME) =>
	skills(page)
		.locator(".mete-skills-row")
		.filter({ has: page.getByText(`${name}/SKILL.md`, { exact: true }) })
		.filter({ has: page.getByText(scope, { exact: true }) });
const status = (entry: Locator) =>
	entry.locator(".mete-skills-row-head > span");
const button = (within: Locator, name: string) =>
	within.getByRole("button", { name, exact: true });
const activate = async (control: Locator) => {
	await expect(control).toBeEnabled();
	await control.focus();
	await expect(control).toBeFocused();
	await control.press("Enter");
};
const daemonPid = (dir: string) => {
	const file = join(dir, ".mete", "cache", "run.lock");
	if (!existsSync(file)) return 0;
	const pid = Number(readFileSync(file, "utf8").split("\n")[0]);
	if (!Number.isSafeInteger(pid) || pid <= 0)
		throw new Error("Invalid fixture daemon lock");
	return pid;
};
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH")
			return false;
		throw error;
	}
};
const replacedDaemon = async (dir: string, previous: number) => {
	await expect
		.poll(() => daemonPid(dir), { timeout: 60_000 })
		.toBeGreaterThan(0);
	expect(daemonPid(dir)).not.toBe(previous);
	await expect.poll(() => alive(previous), { timeout: 60_000 }).toBe(false);
};
const seedGlobal = (mete: Launch) => {
	const source = join(mete.globalDir, "skills", NAME, "SKILL.md");
	mkdirSync(dirname(source), { recursive: true });
	writeFileSync(source, SOURCE);
	writeFileSync(join(mete.globalDir, "settings.yaml"), GLOBAL_YAML);
};
const seedWorkspace = (mete: Launch) => {
	for (const [relative, text] of [
		[RELATIVE, SOURCE],
		[".mete/skills/invalid-field/SKILL.md", INVALID],
	] as const) {
		const path = join(mete.dir, relative);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}
};
const emptyDiscovery = async (mete: Launch) => {
	const roots = [
		join(mete.dir, ".mete", "skills"),
		join(mete.globalDir, "skills"),
	];
	for (const root of roots) expect(existsSync(root)).toBe(false);
	await activate(button(skills(mete.page), "Discover"));
	await expect(
		skills(mete.page).getByText("No skills found.", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(skills(mete.page).locator(".mete-skills-row")).toHaveCount(0);
	for (const root of roots) expect(existsSync(root)).toBe(false);
};
const persistedManagementOnly = (mete: Launch) => {
	const workspace = new DatabaseSync(join(mete.dir, ".mete", "mete.db"), {
		readOnly: true,
	});
	try {
		expect(
			workspace.prepare("SELECT COUNT(*) AS count FROM runs").get(),
		).toEqual({ count: 0 });
		expect(
			workspace.prepare("SELECT COUNT(*) AS count FROM model_calls").get(),
		).toEqual({ count: 0 });
	} finally {
		workspace.close();
	}
	const global = new DatabaseSync(join(mete.globalDir, "mete.db"), {
		readOnly: true,
	});
	try {
		expect(
			global
				.prepare(
					"SELECT json_extract(record, '$.enabled') AS enabled, json_extract(record, '$.revision') AS revision FROM skill_trust_grants",
				)
				.all(),
		).toEqual([{ enabled: 0, revision: 2 }]);
		expect(
			global
				.prepare("SELECT COUNT(*) AS count FROM skill_trust_decisions")
				.get(),
		).toEqual({ count: 2 });
	} finally {
		global.close();
	}
};
const unchangedFiles = (mete: Launch, workspaceSource = SOURCE) => {
	expect(readFileSync(join(mete.dir, RELATIVE), "utf8")).toBe(workspaceSource);
	expect(
		readFileSync(join(mete.globalDir, "skills", NAME, "SKILL.md"), "utf8"),
	).toBe(SOURCE);
	expect(
		readFileSync(join(mete.dir, ".mete/skills/invalid-field/SKILL.md"), "utf8"),
	).toBe(INVALID);
	expect(readFileSync(join(mete.dir, ".mete/mcp.yaml"), "utf8")).toBe(YAML);
	expect(readFileSync(join(mete.globalDir, "settings.yaml"), "utf8")).toBe(
		GLOBAL_YAML,
	);
};
const settingsChrome = async (page: Page) => {
	const settings = page.locator(".mete-settings");
	for (const name of [
		"Save changes",
		"Apply now",
		"This folder",
		"All folders",
	])
		await expect(button(settings, name)).toHaveCount(0);
	await expect(
		settings.getByText("Loaded configuration", { exact: true }),
	).toHaveCount(0);
	await expect(skills(page).getByText(/\b(?:Used|Loaded)\b/)).toHaveCount(0);
};
const openSkills = async (page: Page) => {
	await runCommand(page, "METE: Show settings");
	const group = page
		.locator('[aria-label="Settings groups"] button')
		.filter({ has: page.getByText("Skills", { exact: true }) });
	await expect(
		page.getByLabel("Search settings", { exact: true }),
	).toBeVisible();
	if (await group.isVisible()) await activate(group);
	else
		await page
			.getByRole("combobox", { name: "Settings groups" })
			.selectOption({ label: "Skills" });
	await expect(skills(page)).toBeVisible();
	await settingsChrome(page);
};
const discover = async (page: Page) => {
	await expect(skills(page).locator(".mete-skills-row")).toHaveCount(0);
	await activate(button(skills(page), "Refresh skills"));
	await expect(status(row(page, "Workspace"))).toHaveText("Unapproved", {
		timeout: 60_000,
	});
	await expect(status(row(page, "Global"))).toHaveText("Unapproved");
	const invalid = row(page, "Workspace", "invalid-field");
	await expect(status(invalid)).toHaveText("Invalid");
	await expect(invalid).toContainText("frontmatter");
	await expect(button(invalid, "Review")).toBeDisabled();
	await expect(button(row(page, "Workspace"), "Disable")).toHaveCount(0);
};
const review = async (page: Page, source = SOURCE) => {
	await activate(button(row(page, "Workspace"), "Review"));
	const field = skills(page).getByRole("textbox", {
		name: "Masked SKILL.md",
		exact: true,
	});
	await expect(field).toHaveValue(source, { timeout: 60_000 });
	await expect(field).toHaveAttribute("readonly", "");
	await expect(
		skills(page).getByRole("region", { name: "Review", exact: true }),
	).toContainText("Tool permissions (unsupported)");
	await expect(skills(page)).toContainText("Raw file SHA-256");
	await expect(skills(page)).toContainText(
		createHash("sha256").update(source).digest("hex"),
	);
	await expect(skills(page).locator("script")).toHaveCount(0);
	await field.focus();
	await field.press("Control+Home");
	await field.press("Control+End");
	await expect
		.poll(() => field.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	await field.press("Control+Home");
	return field;
};
const reviewLayout = async (page: Page, label: string, width: number) => {
	const field = skills(page).getByRole("textbox", {
		name: "Masked SKILL.md",
		exact: true,
	});
	await field.scrollIntoViewIfNeeded();
	await field.focus();
	await expect(field).toHaveValue(SOURCE);
	for (const selector of [
		".mete-settings",
		".mete-skills",
		".mete-skills-text",
	]) {
		const size = await page.locator(selector).evaluate((element) => ({
			client: element.clientWidth,
			scroll: element.scrollWidth,
		}));
		expect(size.scroll, `${label}/${width}/${selector}`).toBeLessThanOrEqual(
			size.client + 2,
		);
	}
	const scroller = await field.evaluate((element) => ({
		height: element.clientHeight,
		scroll: element.scrollHeight,
		bound: element.getBoundingClientRect().height,
	}));
	expect(scroller.bound).toBeLessThanOrEqual(320);
	expect(scroller.scroll).toBeGreaterThan(scroller.height);
};
const captureSize = async (page: Page, label: string, width: number) => {
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
		await reviewLayout(page, label, width);
		await settingsChrome(page);
		expect(await meteViolations(page)).toEqual([]);
		await page.screenshot({
			path: test.info().outputPath(`skills-review-${label}-${width}.png`),
		});
	} finally {
		await cdp.detach();
	}
};
const captureThemes = async (page: Page) => {
	for (const [theme, label] of [
		["Light (Theia)", "light"],
		["Dark (Theia)", "dark"],
		["High Contrast (Theia)", "contrast"],
	] as const) {
		await chooseTheme(page, theme);
		for (const width of [1366, 700]) await captureSize(page, label, width);
	}
};

// Opt-in, bounded attachment window; all paths and the CDP port belong to this fixture.
const holdForQA = async (mete: Launch) => {
	const value = process.env.METE_SKILLS_QA_HOLD_MS;
	if (!value) return false;
	const duration = Number(value);
	if (!Number.isSafeInteger(duration) || duration < 1 || duration > 60_000)
		throw new Error("METE_SKILLS_QA_HOLD_MS must be 1..60000");
	writeFileSync(
		test.info().outputPath("skills-attach.json"),
		JSON.stringify({
			port: mete.port,
			workspace: mete.dir,
			globalDir: mete.globalDir,
			stage: "Review",
		}),
	);
	await mete.page.waitForTimeout(duration);
	return true;
};

const approve = async (mete: Launch) => {
	await expect(status(row(mete.page, "Workspace"))).toHaveText("Unapproved");
	await expect(button(row(mete.page, "Workspace"), "Disable")).toHaveCount(0);
	const before = daemonPid(mete.dir);
	expect(before).toBeGreaterThan(0);
	await activate(button(skills(mete.page), "Approve"));
	await expect(status(row(mete.page, "Workspace"))).toHaveText("Approved", {
		timeout: 60_000,
	});
	await expect(
		skills(mete.page).getByRole("textbox", { name: "Masked SKILL.md" }),
	).toHaveCount(0);
	await replacedDaemon(mete.dir, before);
	await activate(button(skills(mete.page), "Refresh skills"));
	await expect(status(row(mete.page, "Workspace"))).toHaveText("Approved");
	await expect(status(row(mete.page, "Global"))).toHaveText("Unapproved");
	unchangedFiles(mete);
};
const restoredThenChanged = async (mete: Launch) => {
	const page = await mete.restart();
	unchangedFiles(mete);
	await openSkills(page);
	await activate(button(skills(page), "Discover"));
	await expect(status(row(page, "Workspace"))).toHaveText("Approved", {
		timeout: 60_000,
	});
	await expect(status(row(page, "Global"))).toHaveText("Unapproved");
	const changed = `${SOURCE}Changed actual fixture bytes after approval.\n`;
	writeFileSync(join(mete.dir, RELATIVE), changed);
	await activate(button(skills(page), "Refresh skills"));
	await expect(status(row(page, "Workspace"))).toHaveText("Changed", {
		timeout: 60_000,
	});
	await review(page, changed);
	await activate(button(skills(page), "Close review"));
	const before = daemonPid(mete.dir);
	await activate(button(row(page, "Workspace"), "Disable"));
	await expect(status(row(page, "Workspace"))).toHaveText("Disabled", {
		timeout: 60_000,
	});
	await replacedDaemon(mete.dir, before);
	await expect(button(row(page, "Workspace"), "Disable")).toHaveCount(0);
	await expect(status(row(page, "Global"))).toHaveText("Unapproved");
	unchangedFiles(mete, changed);
	await settingsChrome(page);
};

test("Skills reviews exact local sources, persists approval across restart, and disables changed versions", async ({
	mete,
}) => {
	test.setTimeout(600_000);
	await openSkills(mete.page);
	await emptyDiscovery(mete);
	seedGlobal(mete);
	seedWorkspace(mete);
	await discover(mete.page);
	await review(mete.page);
	await captureThemes(mete.page);
	if (await holdForQA(mete)) {
		await activate(button(skills(mete.page), "Close review"));
		await review(mete.page);
	}
	await approve(mete);
	await restoredThenChanged(mete);
	persistedManagementOnly(mete);
});
