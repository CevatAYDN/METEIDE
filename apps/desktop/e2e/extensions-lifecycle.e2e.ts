import { copyFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, runCommand, test } from "./launch.js";
import { startOfflineRegistry } from "./openvsx-fixture.js";
import { openPalette } from "./palette.js";

test.use({
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

let registry: Awaited<ReturnType<typeof startOfflineRegistry>>;
let oldRegistry: string | undefined;
test.beforeAll(async () => {
	oldRegistry = process.env.VSX_REGISTRY_URL;
	registry = await startOfflineRegistry();
	process.env.VSX_REGISTRY_URL = registry.url;
});
test.afterAll(async () => {
	if (oldRegistry === undefined) delete process.env.VSX_REGISTRY_URL;
	else process.env.VSX_REGISTRY_URL = oldRegistry;
	await registry?.close();
});

const extensionRow = (page: Page) =>
	page
		.locator(".theia-vsx-extension")
		.filter({ hasText: "METE Lifecycle Fixture" });

const installed = async (page: Page) => {
	await runCommand(page, "Extensions: Show Installed Extensions");
	const row = extensionRow(page);
	await expect(row).toBeVisible({ timeout: 60_000 });
	return row;
};

const contextAction = async (row: Locator, label: string) => {
	await row.click({ button: "right" });
	await row.page().getByRole("menuitem", { name: label, exact: true }).click();
};

const ping = async (page: Page, dir: string) => {
	const marker = join(dir, "extension-activation.txt");
	if (existsSync(marker)) unlinkSync(marker);
	await runCommand(page, "METE Fixture: Ping");
	await expect.poll(() => existsSync(marker)).toBe(true);
	expect(readFileSync(marker, "utf8")).toBe(
		"METE lifecycle fixture activated\n",
	);
};

const noPing = async (page: Page) => {
	const input = await openPalette(page);
	await input.fill("METE Fixture: Ping");
	await expect(
		page.getByRole("option").filter({ hasText: "METE Fixture: Ping" }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
};

const reloadFromRow = async (row: Locator, stage: string) => {
	const page = row.page();
	await page.screenshot({
		path: test.info().outputPath(`before-${stage}-reload.png`),
	});
	const reload = row.getByRole("button", {
		name: "Reload Window",
		exact: true,
	});
	await expect(reload).toBeVisible();
	await Promise.all([
		page.waitForEvent("domcontentloaded", { timeout: 20_000 }),
		reload.click(),
	]);
	await expect(page.locator("#theia-app-shell")).toBeVisible({
		timeout: 60_000,
	});
};

const installLocal = async (page: Page, dir: string) => {
	copyFileSync(
		join(process.cwd(), "e2e", "fixtures", "lifecycle-extension.vsix"),
		join(dir, "lifecycle-extension.vsix"),
	);
	await page.keyboard.press("Control+Shift+E");
	const file = page.getByText("lifecycle-extension.vsix", { exact: true });
	await expect(file).toBeVisible({ timeout: 60_000 });
	await file.click({ button: "right" });
	await page
		.getByRole("menuitem", { name: "Install Extension VSIX", exact: true })
		.click();
	return installed(page);
};

test("native VSIX installs, disables, enables and removes a working local extension", async ({
	mete,
}) => {
	const { page, dir } = mete;
	const row = await installLocal(page, dir);
	await ping(page, dir);
	await contextAction(row, "Disable");
	await expect(row).toContainText("Extension (disabled)");
	await reloadFromRow(row, "disable");
	await noPing(page);
	await contextAction(row, "Enable");
	await expect(row).not.toContainText("Extension (disabled)");
	if (
		await row
			.getByRole("button", { name: "Reload Window", exact: true })
			.isVisible()
	)
		await reloadFromRow(row, "enable");
	await ping(page, dir);
	await row.getByRole("button", { name: "Uninstall", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await row.count()) === 0 ||
				(await row
					.getByRole("button", { name: "Reload Window", exact: true })
					.isVisible()),
		)
		.toBe(true);
	if (await row.count()) await reloadFromRow(row, "remove");
	await expect(row).toHaveCount(0, { timeout: 60_000 });
	await noPing(page);
	expect(registry.requests).toEqual([]);
	await page.screenshot({
		path: test.info().outputPath("extension-removed.png"),
	});
});
