import type { Locator, Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, runCommand, startRun, test } from "./launch.js";

const fixture = (
	id: string,
	name: string,
	apiVersion: string,
	verify: readonly object[],
) =>
	JSON.stringify({
		apiVersion,
		kind: "TeamTemplate",
		metadata: { id, name, version: "1.0.0" },
		pattern: "pipeline",
		roles: [
			{
				id: "worker",
				name: "Worker",
				goal: "Check the fixture",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: [{ id: "check", role: "worker", title: "Check fixture", verify }],
		budget: { cloud_requests: 1, max_hours: 1 },
	});

test.use({
	files: {
		".mete/teams/required-gate.yaml": fixture(
			"required-gate",
			"Required verification",
			"mete/v1",
			[{ capability: "gameengine.test@1" }],
		),
		".mete/teams/optional-gate.yaml": fixture(
			"optional-gate",
			"Optional verification",
			"mete/v2",
			[
				{ capability: "fs.list@1", args: { path: "." } },
				{ capability: "gameengine.test@1", optional: true },
			],
		),
		".mete/teams/failed-gate.yaml": fixture(
			"failed-gate",
			"Failed verification",
			"mete/v2",
			[{ capability: "fs.read@1", args: { path: "missing-evidence.txt" } }],
		),
	},
	script: {
		turns: [
			[
				{ type: "text", text: "A fixture report, not a verification claim." },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const evidence = (page: Page) =>
	page.getByRole("region", { name: "Verification evidence", exact: true });
const status = (page: Page, expected: string) =>
	expect(page.locator(".mete-run .mete-pill")).toHaveAttribute(
		"data-status",
		expected,
		{
			timeout: 60_000,
		},
	);

const openEvidence = async (page: Page, outcome: string) => {
	const panel = evidence(page);
	await expect(panel).toBeVisible({ timeout: 60_000 });
	await expect(panel).toContainText("Strict verification");
	await expect(panel).not.toHaveAttribute("aria-busy", "true");
	const task = panel.locator("details.mete-verification-task");
	await expect(task).toHaveCount(1);
	await expect(task.locator(".mete-verification-summary")).toHaveText(
		`Current checks: ${outcome}`,
	);
	await expect(task.locator(".mete-verification-summary")).toBeVisible();
	if ((await task.getAttribute("open")) === null) {
		await task.locator(":scope > summary").focus();
		await page.keyboard.press("Enter");
	}
	await expect(task).toHaveAttribute("open");
	return task;
};

const checkRequired = async (page: Page) => {
	await status(page, "paused");
	const task = await openEvidence(page, "Not run");
	const row = task.locator('[data-gate-index="0"]');
	await expect(row).toContainText("gameengine.test@1");
	await expect(row.getByText("Required", { exact: true })).toBeVisible();
	await expect(row.getByText("Not run", { exact: true })).toBeVisible();
	await expect(
		row.getByText("Capability unavailable", { exact: true }),
	).toBeVisible();
	await expect(row.getByText("Passed", { exact: true })).toHaveCount(0);
	await expect(page.locator(".mete-run")).toContainText(
		"Verification needs attention.",
	);
	return task;
};

const checkOptional = async (page: Page) => {
	await status(page, "completed");
	const task = await openEvidence(page, "Passed, Not run");
	const passed = task.locator('[data-gate-index="0"]');
	await expect(passed).toContainText("fs.list@1");
	await expect(passed.getByText("Required", { exact: true })).toBeVisible();
	await expect(passed.getByText("Passed", { exact: true })).toBeVisible();
	const skipped = task.locator('[data-gate-index="1"]');
	await expect(skipped).toContainText("gameengine.test@1");
	await expect(skipped.getByText("Optional", { exact: true })).toBeVisible();
	await expect(skipped.getByText("Not run", { exact: true })).toBeVisible();
	await expect(
		skipped.getByText("Capability unavailable", { exact: true }),
	).toBeVisible();
	await expect(skipped.getByText("Passed", { exact: true })).toHaveCount(0);
	return task;
};

const checkFailed = async (page: Page) => {
	// One scripted request is the budget; after the failed check, repair waits without another model call.
	await status(page, "paused");
	const task = await openEvidence(page, "Failed");
	const row = task.locator('[data-gate-index="0"]');
	await expect(row).toContainText("fs.read@1");
	await expect(row.getByText("Failed", { exact: true })).toBeVisible();
	await expect(row.getByText("Not run", { exact: true })).toHaveCount(0);
	await expect(row.locator("pre")).not.toBeEmpty();
	return task;
};

const evaluationId = async (task: Locator) => {
	const identity = task.locator(".mete-verification-identity").first();
	if ((await identity.getAttribute("open")) === null)
		await identity.locator(":scope > summary").click();
	const value = await identity.locator("dd code").nth(1).textContent();
	expect(value).toMatch(/^[a-f0-9-]{36}$/);
	await identity.locator(":scope > summary").click();
	return value;
};

const openRun = async (page: Page, goal: string) => {
	await runCommand(page, "METE: Open home");
	await page
		.getByRole("region", { name: "Team runs", exact: true })
		.getByRole("button", { name: goal, exact: true })
		.click();
};

const captureLayout = async (page: Page, theme: string, width: number) => {
	await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
	const task = await checkOptional(page);
	const refresh = evidence(page).getByRole("button", {
		name: "Refresh verification evidence",
	});
	await refresh.focus();
	await expect(refresh).toBeFocused();
	await refresh.click({ trial: true });
	await task.locator('[data-gate-index="1"]').scrollIntoViewIfNeeded();
	const size = await evidence(page).evaluate((element) => ({
		width: element.clientWidth,
		scroll: element.scrollWidth,
	}));
	expect(size.scroll).toBeLessThanOrEqual(size.width + 2);
	await page.screenshot({
		path: test.info().outputPath(`verification-${theme}-${width}.png`),
	});
	expect(await meteViolations(page)).toEqual([]);
};

const layouts = async (page: Page) => {
	const cdp = await page.context().newCDPSession(page);
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const width of [1366, 700]) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: 900,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await captureLayout(page, theme, width);
		}
	}
};

// Final-stage acceptance includes one deliberate restart, never an implementation-time launch.
test("required blocks, optional gaps and executed failures persist with exact evidence", async ({
	mete,
}) => {
	let page = mete.page;
	await startRun(page, {
		goal: "Required gate proof",
		team: /^Required verification/,
	});
	const required = await evaluationId(await checkRequired(page));
	await startRun(page, {
		goal: "Optional gate proof",
		team: /^Optional verification/,
	});
	const optional = await evaluationId(await checkOptional(page));
	await startRun(page, {
		goal: "Failed gate proof",
		team: /^Failed verification/,
	});
	const failed = await evaluationId(await checkFailed(page));
	page = await mete.restart();
	await openRun(page, "Required gate proof");
	expect(await evaluationId(await checkRequired(page))).toBe(required);
	await openRun(page, "Failed gate proof");
	expect(await evaluationId(await checkFailed(page))).toBe(failed);
	await openRun(page, "Optional gate proof");
	expect(await evaluationId(await checkOptional(page))).toBe(optional);
	await layouts(page);
});
