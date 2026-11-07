import type { Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, runCommand, startRun, test } from "./launch.js";

const TITLE = "Persistent conversation";
const MESSAGE = "Findable follow-up needle";
const say = (text: string) => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
];
test.use({ script: { turns: [say("First answer"), say("Second answer")] } });

const messages = (page: Page) =>
	page
		.getByRole("region", { name: "Conversation", exact: true })
		.locator(".mete-chat-message");
const rows = (page: Page) =>
	page
		.getByRole("region", { name: "Conversations", exact: true })
		.locator("li");
const search = (page: Page) =>
	page.getByRole("searchbox", { name: "Search conversations", exact: true });

const expectRestored = async (page: Page) => {
	try {
		await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
	} catch (error) {
		await page.screenshot({
			path: test.info().outputPath("restart-failure.png"),
		});
		await test.info().attach("restart-state", {
			body: await page.locator("body").innerText(),
			contentType: "text/plain",
		});
		throw error;
	}
};

const checkHistory = async (page: Page) => {
	await page.getByText("Run history", { exact: true }).click();
	await page
		.getByRole("button", { name: `Turn 1 of 2: ${TITLE}`, exact: true })
		.click();
	await expect(
		messages(page).getByText("First answer", { exact: true }),
	).toBeVisible();
	await expect(
		messages(page).getByText("Second answer", { exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("textbox", { name: "Message METE" }),
	).toBeDisabled();
	await page
		.getByRole("button", { name: "Return to latest", exact: true })
		.click();
	await expect(
		messages(page).getByText("Second answer", { exact: true }),
	).toBeVisible();
};

const checkSearch = async (page: Page) => {
	await search(page).fill("follow-up needle");
	await expect(rows(page)).toHaveCount(1);
	await expect(
		rows(page).getByRole("button", { name: TITLE, exact: true }),
	).toBeVisible();
	await search(page).fill("no matching conversation");
	await expect(rows(page)).toHaveCount(0);
	await expect(
		page.getByText("No conversations match this search.", { exact: true }),
	).toBeVisible();
	await search(page).fill("");
	await expect(rows(page)).toHaveCount(1);
	await expect(
		page
			.getByRole("region", { name: "Team runs", exact: true })
			.getByText("No team runs in this folder yet.", { exact: true }),
	).toBeVisible();
};

const checkThemes = async (page: Page) => {
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
			const size = await page
				.getByRole("region", { name: "Conversations", exact: true })
				.evaluate((element) => ({
					width: element.clientWidth,
					scroll: element.scrollWidth,
				}));
			expect(size.scroll).toBeLessThanOrEqual(size.width + 2);
			await page.screenshot({
				path: test.info().outputPath(`threads-${theme}-${width}.png`),
			});
		}
	}
	expect(await meteViolations(page)).toEqual([]);
};

test("keeps two turns in one searchable conversation across a real application restart", async ({
	mete,
}) => {
	let page = mete.page;
	await startRun(page, { goal: TITLE, team: /single agent/i });
	await expect(
		messages(page).getByText("First answer", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await page.getByRole("textbox", { name: "Message METE" }).fill(MESSAGE);
	await page.getByRole("textbox", { name: "Message METE" }).press("Enter");
	await expect(
		messages(page).getByText("Second answer", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(rows(page)).toHaveCount(1);
	await checkSearch(page);
	await checkHistory(page);
	page = await mete.restart();
	await runCommand(page, "METE: Open home");
	await expectRestored(page);
	await rows(page).getByRole("button", { name: TITLE, exact: true }).click();
	await expect(
		messages(page).getByText("Second answer", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await checkSearch(page);
	await checkHistory(page);
	await checkThemes(page);
});
