import type { Locator, Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, runCommand, startRun, test } from "./launch.js";

const AUTOMATIC = "Automatic model evidence";
const PREFERRED = "Preferred model evidence";
const LONG_PREFERENCE = `scripted/${"unlisted-preference-".repeat(12)}`;
test.use({
	script: {
		turns: [
			[
				{ type: "text", text: "Offline discovery response." },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const conversations = (page: Page) =>
	page.getByRole("region", { name: "Conversations", exact: true });

const checkEmpty = async (page: Page) => {
	await runCommand(page, "METE: Open home");
	const list = conversations(page);
	const search = list.getByRole("searchbox", { name: "Search conversations" });
	await expect(
		list.getByText("No conversations yet.", { exact: true }),
	).toBeVisible();
	await search.fill("missing conversation");
	await expect(
		list.getByText("No conversations match this search.", { exact: true }),
	).toBeVisible();
	await expect(
		list.getByText("No conversations yet.", { exact: true }),
	).toHaveCount(0);
	await search.fill(" ");
	await expect(
		list.getByText("No conversations yet.", { exact: true }),
	).toBeVisible();
	await search.fill("");
};

const checkSettings = async (page: Page) => {
	await runCommand(page, "METE: Show settings");
	const search = page.getByRole("searchbox", { name: "Search settings" });
	await search.fill("daily spend");
	const cap = page.getByLabel("Daily spending cap (US dollars)", {
		exact: true,
	});
	await expect(cap).toBeEnabled({ timeout: 60_000 });
	await cap.fill("3");
	await search.fill("theme");
	await expect(
		page.getByRole("button", { name: "Preferences", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Display language", exact: true }),
	).toBeVisible();
	await search.fill("extensions");
	const extensions = page.getByRole("button", {
		name: "Editor extensions",
		exact: true,
	});
	await extensions.focus();
	await expect(extensions).toBeFocused();
	await search.fill("unknown-setting-value");
	await expect(
		page.getByText("No settings match", { exact: false }),
	).toBeVisible();
	await search.fill("daily spend");
	await expect(cap).toHaveValue("3");
	await expect(
		page.getByRole("region", { name: "Save changes" }),
	).toContainText("Unsaved changes: gateway");
};

const awaitAnswer = async (page: Page) => {
	await expect(page.locator(".mete-chat-header")).toContainText("Done", {
		timeout: 60_000,
	});
	await expect(
		page
			.locator(".mete-chat-message")
			.getByText("Offline discovery response.", { exact: true }),
	).toBeVisible();
};

const startPreferred = async (page: Page) => {
	await runCommand(page, "METE: Start run");
	const goal = page.locator("textarea.mete-field");
	await expect(goal).toBeVisible({ timeout: 60_000 });
	await goal.fill(PREFERRED);
	const picker = page.getByRole("combobox", {
		name: "Preferred model (optional)",
		exact: true,
	});
	await picker.fill(LONG_PREFERENCE);
	await picker.press("Tab");
	await page.getByRole("button", { name: "Start run", exact: true }).click();
	await awaitAnswer(page);
};

const reachable = async (target: Locator) => {
	await expect(target).toBeVisible();
	const bounds = await target.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const status = document.querySelector("#theia-statusBar");
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
			left: rect.left,
			right: rect.right,
			top: rect.top,
			bottom: rect.bottom,
			limit: status?.getBoundingClientRect().top ?? innerHeight,
			width: innerWidth,
			overflow: element.scrollWidth - element.clientWidth,
			uncovered,
		};
	});
	expect(bounds.left).toBeGreaterThanOrEqual(0);
	expect(bounds.right).toBeLessThanOrEqual(bounds.width);
	expect(bounds.top).toBeGreaterThanOrEqual(0);
	expect(bounds.bottom).toBeLessThanOrEqual(bounds.limit);
	expect(bounds.overflow).toBeLessThanOrEqual(2);
	expect(bounds.uncovered).toBe(true);
};

const checkLayouts = async (page: Page) => {
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
			await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
			const header = page.locator(".mete-chat-header");
			await reachable(
				header.getByText("Last model: scripted/scripted-1", { exact: true }),
			);
			await reachable(
				header.getByText(`Preferred model: ${LONG_PREFERENCE}`, {
					exact: true,
				}),
			);
			const message = page.getByRole("textbox", {
				name: "Message METE",
				exact: true,
			});
			await message.fill("Draft retained during layout checks");
			await message.focus();
			await expect(message).toBeFocused();
			await reachable(message);
			const send = page.getByRole("button", {
				name: "Send message",
				exact: true,
			});
			await expect(send).toBeEnabled();
			await reachable(send);
			const diagnostics = page.locator(".mete-chat-details").filter({
				has: page.getByText("Activity, model and checkpoints", { exact: true }),
			});
			await expect(diagnostics).not.toHaveAttribute("open");
			await page.screenshot({
				path: test.info().outputPath(`discovery-${theme}-${width}.png`),
			});
			expect(await meteViolations(page)).toEqual([]);
		}
	}
};

// One application session covers the approved batch, without an intermediate IDE restart.
test("model evidence, settings discovery and truthful empty states stay usable together", async ({
	mete,
}) => {
	const { page } = mete;
	await checkEmpty(page);
	await checkSettings(page);
	await startRun(page, { goal: AUTOMATIC, team: /single agent/i });
	await awaitAnswer(page);
	const header = page.locator(".mete-chat-header");
	await expect(header).toContainText("Last model: scripted/scripted-1");
	await expect(header).toContainText("Model selection: Automatic");
	await startPreferred(page);
	await expect(header).toContainText("Last model: scripted/scripted-1");
	await expect(header).toContainText(`Preferred model: ${LONG_PREFERENCE}`);
	await conversations(page)
		.getByRole("button", { name: AUTOMATIC, exact: true })
		.click();
	await expect(header).toContainText("Model selection: Automatic");
	await expect(header).not.toContainText(LONG_PREFERENCE);
	await conversations(page)
		.getByRole("button", { name: PREFERRED, exact: true })
		.click();
	await expect(header).toContainText(`Preferred model: ${LONG_PREFERENCE}`);
	await checkLayouts(page);
});
