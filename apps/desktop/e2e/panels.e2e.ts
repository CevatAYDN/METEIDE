import type { Page } from "@playwright/test";
import { expect, runCommand, test } from "./launch.js";

test("the Help update check explains a source build", async ({ mete }) => {
	const { page } = mete;
	await runCommand(page, "METE: Check for Updates");
	const answers = page.getByText(
		/runs from source, not from an installed copy/,
	);
	await expect(answers.first()).toBeVisible({ timeout: 60_000 });
	expect(await answers.count()).toBe(2);
});

// The panels every METE surface hangs from (docs/13): the Welcome screen opens, and the Changes
// panel answers through the real daemon of the fresh git workspace.

test("the Welcome screen opens", async ({ mete }) => {
	const { page } = mete;
	await runCommand(page, "METE: Welcome");
	await expect(page.getByText("Welcome to METE", { exact: false })).toBeVisible(
		{ timeout: 60_000 },
	);
});

test("the Changes panel reads an empty working tree", async ({ mete }) => {
	const { page } = mete;
	await runCommand(page, "METE: Open changes");
	await expect(page.getByText("No changes.")).toBeVisible({
		timeout: 60_000,
	});
});

// The screens row (docs/13): every main panel is one click away in the status bar, not only from the
// command palette, and each button runs the same command its METE menu entry does.
const expectScreenButtons = async (page: Page) => {
	for (const screen of [
		"run",
		"team",
		"changes",
		"memory",
		"quota",
		"audit",
		"settings",
	])
		await expect(
			page.locator(`[id="status-bar-mete-screens-${screen}"]`),
		).toBeVisible();
};

const openRunAndTeam = async (page: Page) => {
	await page.locator('[id="status-bar-mete-screens-run"]').click();
	const goal = page.locator("textarea.mete-field");
	await expect(goal).toBeVisible({
		timeout: 60_000,
	});
	await expect(goal).toBeFocused();

	await page.locator('[id="status-bar-mete-screens-team"]').click();
	await expect(page.locator(".mete-panel textarea.mete-field")).toBeVisible({
		timeout: 60_000,
	});
};

const openChangesMemoryAndAudit = async (page: Page) => {
	await page.locator('[id="status-bar-mete-screens-changes"]').click();
	await expect(page.getByText("No changes.")).toBeVisible({
		timeout: 60_000,
	});

	await page.locator('[id="status-bar-mete-screens-memory"]').click();
	await expect(page.getByText("No notes yet.", { exact: false })).toBeVisible({
		timeout: 60_000,
	});

	await page.locator('[id="status-bar-mete-screens-audit"]').click();
	await expect(
		page.getByText("No policy decisions yet.", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
};

const openSettingsAndCheckFirstFrame = async (page: Page) => {
	await page.locator('[id="status-bar-mete-screens-settings"]').click();
	const settings = page
		.locator(".mete-panel")
		.filter({ hasText: "As METE loaded them at" });
	await expect(settings).toBeVisible({ timeout: 60_000 });
	const firstCard = settings.locator(".mete-settings-card").first();
	await expect(firstCard).toBeVisible();
	const initialOpacity = await firstCard.evaluate((el) => {
		const animation = el.getAnimations()[0];
		if (animation) animation.currentTime = 0;
		return getComputedStyle(el).opacity;
	});
	expect(initialOpacity).toBe("1");
};

test("the status bar opens the main screens", async ({ mete }) => {
	const { page } = mete;
	await expectScreenButtons(page);
	await openRunAndTeam(page);
	await openChangesMemoryAndAudit(page);
	await openSettingsAndCheckFirstFrame(page);
});

// A window snapped to half of a 2560 px screen leaves the Quota card about 860 px: every column,
// Resets and History included, fits in it, with no sideways scroll hiding one.
test("the Quota table fits a half-screen window", async ({ mete }) => {
	const { page } = mete;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 1392,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await runCommand(page, "METE: Open quota dashboard");
	const card = page.getByRole("region", { name: "Quota units" });
	await expect(card.locator("tbody tr").first()).toBeVisible({
		timeout: 60_000,
	});
	const [client, scroll] = await card.evaluate((e) => [
		e.clientWidth,
		e.scrollWidth,
	]);
	expect(client).toBeLessThan(1000);
	expect(scroll).toBeLessThanOrEqual(client + 2);
});

// A tool that saves an image under .mete/assets/ notes it in the manifest (packages/mcp); the
// Assets view (docs/13; ADR-114) lists it with its picture and the call that saved it.
const SHOT =
	'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3a7"/></svg>';

test.describe("the Assets panel", () => {
	test.use({
		files: {
			".mete/assets/shot.svg": SHOT,
			".mete/assets/manifest.jsonl": `${JSON.stringify({
				path: ".mete/assets/shot.svg",
				mediaType: "image/svg+xml",
				bytes: SHOT.length,
				sha256: "abc",
				server: "demo",
				tool: "render",
				at: "2026-10-25T10:00:00.000Z",
			})}\n`,
		},
	});

	test("lists a saved image with its origin", async ({ mete }) => {
		const { page } = mete;
		// The METE menu lists the Assets screen (docs/13), so the panel is not reachable only from
		// the palette: open it the way a person does.
		await page.locator(".lm-MenuBar-item").filter({ hasText: "METE" }).click();
		await page
			.locator(".lm-Menu-item")
			.filter({ hasText: "Open assets" })
			.click();
		const panel = page.locator(".mete-panel").filter({ hasText: "shot.svg" });
		await expect(panel).toBeVisible({ timeout: 60_000 });
		await expect(panel).toContainText("image/svg+xml");
		await expect(panel).toContainText("demo · render");
		const picture = panel.locator("img").first();
		await expect(picture).toBeVisible();
		// The picture comes from the file itself: a loaded image proves the row previews it.
		await expect
			.poll(() =>
				picture.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0),
			)
			.toBe(true);
	});
});
