import type { Locator, Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, runCommand, test } from "./launch.js";

test.use({
	script: {
		turns: [
			[
				{ type: "text", text: "Offline usability fixture." },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const resize = async (page: Page, width: number, height: number) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await expect
		.poll(() => page.evaluate(() => [innerWidth, innerHeight]))
		.toEqual([width, height]);
};

// Visibility alone permits offscreen elements; check geometry before any auto-scrolling action.
const reachable = async (action: Locator) => {
	await expect(action).toBeVisible();
	const bounds = await action.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const status = document.querySelector("#theia-statusBar");
		const bottom = status?.getBoundingClientRect().top ?? innerHeight;
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const uncovered = [
			[x, y],
			[x, rect.top + 1],
			[x, rect.bottom - 1],
			[rect.left + 1, y],
			[rect.right - 1, y],
		].every(([left, top]) => {
			const hit = document.elementFromPoint(left ?? x, top ?? y);
			return !!hit && element.contains(hit);
		});
		return {
			top: rect.top,
			bottom: rect.bottom,
			limit: bottom,
			left: rect.left,
			right: rect.right,
			width: innerWidth,
			uncovered,
		};
	});
	expect(bounds.top).toBeGreaterThanOrEqual(0);
	expect(bounds.bottom).toBeLessThanOrEqual(bounds.limit);
	expect(bounds.left).toBeGreaterThanOrEqual(0);
	expect(bounds.right).toBeLessThanOrEqual(bounds.width);
	expect(bounds.uncovered).toBe(true);
};

test("@a11y Welcome continuation stays visible while setup scrolls", async ({
	mete,
}) => {
	const { page } = mete;
	await runCommand(page, "METE: Welcome");
	const panel = page.locator(".mete-welcome");
	const start = panel.getByRole("button", { name: "Start a run", exact: true });
	await expect(start).toBeVisible({ timeout: 60_000 });
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const [width, height] of [
			[1707, 960],
			[1024, 768],
			[800, 720],
			[700, 600],
		] as const) {
			await resize(page, width, height);
			await reachable(start);
			const overflow = await panel.evaluate((element) => ({
				client: element.clientWidth,
				scroll: element.scrollWidth,
			}));
			expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 2);
			await page.screenshot({
				path: test.info().outputPath(`welcome-${theme}-${width}.png`),
			});
			expect(await meteViolations(page)).toEqual([]);
		}
	}
	// All required settings remain reachable through ordinary keyboard focus.
	const optionalKey = panel.locator("#mete-welcome-tavily");
	await optionalKey.focus();
	await expect(optionalKey).toBeFocused();
	await reachable(optionalKey);
	await reachable(start);
});

const keyboardTools = async (servers: Locator, bindings: Locator) => {
	const page = servers.page();
	const categories = page.getByRole("combobox", {
		name: "Settings groups",
		exact: true,
	});
	await categories.focus();
	await page.keyboard.press("ArrowUp");
	await expect(categories).toHaveValue("privacy");
	await expect(servers).not.toBeVisible();
	await page.keyboard.press("ArrowDown");
	await expect(categories).toHaveValue("tools");
	await reachable(
		servers.getByRole("button", { name: "Add server", exact: true }),
	);
	await servers
		.getByRole("button", { name: "Add server", exact: true })
		.focus();
	await page.keyboard.press("Enter");
	await expect(servers.locator(".mete-tool-setup")).toBeVisible();
	await expect(servers.getByLabel("Display id", { exact: true })).toBeFocused();
	await servers.getByRole("button", { name: "Cancel", exact: true }).click();
	const advanced = page
		.locator(".mete-settings summary")
		.filter({ hasText: /^Advanced$/ });
	await advanced.focus();
	await page.keyboard.press("Enter");
	await expect(bindings).toBeVisible();
	await expect(
		bindings.getByRole("button", { name: "Add capability", exact: true }),
	).toBeVisible();
};

test("@a11y Tools opens with Add server and keeps bindings behind keyboard disclosure", async ({
	mete,
}) => {
	const { page } = mete;
	await runCommand(page, "METE: Show settings");
	await page
		.locator('[aria-label="Settings groups"] button')
		.filter({ hasText: "Tools and web search" })
		.click();
	const servers = page.getByRole("region", {
		name: "MCP servers",
		exact: true,
	});
	const add = servers.getByRole("button", { name: "Add server", exact: true });
	await expect(add).toBeEnabled({ timeout: 60_000 });
	const bindings = page.getByRole("region", {
		name: "Tool adapters",
		exact: true,
	});
	await expect(bindings).not.toBeVisible();
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const [width, height] of [
			[1366, 768],
			[800, 720],
			[700, 600],
		] as const) {
			await resize(page, width, height);
			await page.screenshot({
				path: test.info().outputPath(`tools-${theme}-${width}.png`),
			});
			await reachable(add);
			expect(await meteViolations(page)).toEqual([]);
		}
	}
	await keyboardTools(servers, bindings);
});
