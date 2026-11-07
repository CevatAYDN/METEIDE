import type { Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { expect, runCommand, startRun, test } from "./launch.js";

test.use({
	script: {
		turns: [
			[
				{ type: "text", text: "The local workspace is ready. ".repeat(50) },
				{
					type: "finish",
					reason: "stop",
					usage: { prompt: 12, completion: 4 },
				},
			],
		],
	},
});

const chooseTheme = async (page: Page, name: string) => {
	await runCommand(page, "Preferences: Color Theme");
	await page.getByText(name, { exact: true }).click();
	await expect(page.locator(".quick-input-widget")).not.toBeVisible();
};

const fits = async (page: Page, width: number) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width,
		height: 768,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
	const composer = page.locator(".mete-chat-composer");
	await expect(composer).toBeVisible();
	await composer
		.getByRole("textbox", { name: "Message METE" })
		.fill("Draft for layout check");
	await expect(
		composer.getByRole("button", { name: "Send message" }),
	).toBeVisible();
	await composer
		.getByRole("button", { name: "Send message" })
		.click({ trial: true });
	const bounds = await composer.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			bottom: rect.bottom,
			height: innerHeight,
			client: element.clientWidth,
			scroll: element.scrollWidth,
		};
	});
	expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
	expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 2);
};

test("conversation actions fit desktop and narrow themes", async ({ mete }) => {
	const { page } = mete;
	await startRun(page, { goal: "Check the workspace", team: /single agent/i });
	await expect(page.locator(".mete-chat-message").last()).toContainText(
		"The local workspace is ready.",
		{ timeout: 60_000 },
	);
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const width of [1366, 700]) {
			await fits(page, width);
			await page.screenshot({
				path: test.info().outputPath(`${theme}-${width}.png`),
			});
			expect(await meteViolations(page)).toEqual([]);
		}
	}
	await runCommand(page, "METE: Show settings");
	const search = page.getByRole("searchbox", { name: "Search settings" });
	await search.fill("mcp");
	await expect(
		page.getByRole("region", { name: "MCP servers", exact: true }),
	).toBeVisible();
	await search.fill("unmatched-setting-name");
	await expect(
		page.getByText("No settings match", { exact: false }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Clear search", exact: true })
		.first()
		.click();
	await expect(search).toHaveValue("");
});
