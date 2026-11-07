import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme, openFile } from "./ide-interactions.js";
import { expect, runCommand, test } from "./launch.js";

const TITLE = "Review editor attachment";
const DISK = "export const disk = 'saved-on-disk';\n";
const DRAFT = "export const n = 'unsaved-selection';";
const UPDATED = "export const n = 'updated-selection';";
const say = (text: string) => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
];
test.use({
	files: { "sample.ts": DISK, "other.ts": "export const other = 2;\n" },
	commit: true,
	script: {
		turns: [say("First context reviewed"), say("Second context reviewed")],
	},
});

const draft = (page: Page) => page.locator(".mete-context-draft");
const snapshots = (page: Page) => draft(page).locator(".mete-context-preview");
const messages = (page: Page) => page.locator(".mete-chat-message");
const editWithoutSaving = async (page: Page, text: string) => {
	const editor = page.locator(".monaco-editor:visible").first();
	await editor.locator(".view-lines").click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type(text, { delay: 1 });
	await page.keyboard.press("Control+Home");
	await expect(editor.locator(".view-lines")).toContainText(
		text.split("\n")[0] ?? text,
	);
	await page.keyboard.press("Control+a");
};
const showPreview = async (page: Page, content: string) => {
	const snapshot = snapshots(page).first();
	await snapshot.locator("summary").click();
	await expect(snapshot.locator("pre")).toHaveText(content);
	await expect(snapshot).toContainText("Unsaved");
};
const sentContext = (page: Page) =>
	page.locator("details.mete-chat-details").filter({
		has: page.locator(":scope > summary", {
			hasText: "Sent attachments for this turn",
		}),
	});
const inspectSent = async (page: Page, content: string) => {
	const sent = sentContext(page);
	await expect(sent).toBeVisible();
	await sent.locator(":scope > summary").click();
	const snapshot = sent.locator(".mete-context-preview").first();
	await snapshot.locator("summary").click();
	await expect(snapshot.locator("pre")).toHaveText(content);
	await expect(
		messages(page).filter({ hasText: "<user-context>" }),
	).toHaveCount(0);
};
const captureThemes = async (
	page: Page,
	selector = ".mete-chat-layout",
	stage = "sent",
) => {
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
			const size = await page.locator(selector).evaluate((element) => ({
				width: element.clientWidth,
				scroll: element.scrollWidth,
			}));
			expect(size.scroll).toBeLessThanOrEqual(size.width + 2);
			if (stage === "drafts") {
				const send = await page
					.getByRole("button", { name: "Start run", exact: true })
					.boundingBox();
				expect(send).not.toBeNull();
				expect((send?.y ?? 0) + (send?.height ?? 0)).toBeLessThanOrEqual(900);
			}
			await page.screenshot({
				path: test.info().outputPath(`context-${stage}-${theme}-${width}.png`),
			});
		}
	}
	expect(await meteViolations(page)).toEqual([]);
};

const prepareDraft = async (page: Page, dir: string) => {
	await runCommand(page, "METE: Start run");
	await page.locator("textarea.mete-field").fill(TITLE);
	await openFile(page, "sample.ts");
	await editWithoutSaving(page, DRAFT);
	await runCommand(page, "METE: Add selection");
	await expect(snapshots(page)).toHaveCount(1);
	await showPreview(page, DRAFT);
	expect(readFileSync(join(dir, "sample.ts"), "utf8")).toBe(DISK);

	await openFile(page, "sample.ts");
	await editWithoutSaving(page, UPDATED);
	await runCommand(page, "METE: Start run");
	await expect(snapshots(page).first().locator("pre")).toHaveText(DRAFT);
	await draft(page)
		.getByRole("button", { name: "Update attachment", exact: true })
		.click();
	await expect(snapshots(page).first().locator("pre")).toHaveText(UPDATED);
	await draft(page)
		.getByRole("button", { name: "Remove attachment", exact: true })
		.click();
	await expect(snapshots(page)).toHaveCount(0);
	await draft(page).getByLabel("Add attachment", { exact: true }).click();
	await draft(page)
		.getByRole("button", { name: "Add open file", exact: true })
		.click();
	await expect(snapshots(page)).toHaveCount(1);
	await showPreview(page, UPDATED);
};

const sendAfterFailure = async (page: Page, dir: string) => {
	writeFileSync(join(dir, ".meteignore"), "sample.ts\n");
	await page.getByRole("button", { name: "Start run", exact: true }).click();
	await expect(page.locator("textarea.mete-field")).toHaveValue(TITLE);
	await expect(snapshots(page).first().locator("pre")).toHaveText(UPDATED);
	await expect(
		page.getByRole("alert").filter({ hasText: /./ }).first(),
	).toBeVisible();
	writeFileSync(join(dir, ".meteignore"), "");
	await page.getByRole("button", { name: "Start run", exact: true }).click();
	await expect(
		messages(page).getByText("First context reviewed", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(snapshots(page)).toHaveCount(0);
	await inspectSent(page, UPDATED);
	expect(readFileSync(join(dir, "sample.ts"), "utf8")).toBe(DISK);
};

const sendFollowup = async (page: Page) => {
	await openFile(page, "other.ts");
	await runCommand(page, "METE: Add open file");
	await expect(snapshots(page)).toHaveCount(1);
	await page
		.getByRole("textbox", { name: "Message METE" })
		.fill("Review the second file");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await expect(
		messages(page).getByText("Second context reviewed", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(
		page
			.getByRole("region", { name: "Conversations", exact: true })
			.locator("li"),
	).toHaveCount(1);
};

test("captures unsaved editor text explicitly, keeps failed drafts and restores sent context", async ({
	mete,
}) => {
	let page = mete.page;
	await prepareDraft(page, mete.dir);
	await sendAfterFailure(page, mete.dir);
	await sendFollowup(page);
	page = await mete.restart();
	await runCommand(page, "METE: Open home");
	await page
		.getByRole("region", { name: "Conversations", exact: true })
		.getByRole("button", { name: TITLE, exact: true })
		.click();
	await expect(
		messages(page).getByText("Second context reviewed", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await inspectSent(page, "export const other = 2;\n");
	await page.getByText("Run history", { exact: true }).click();
	await page
		.getByRole("button", { name: `Turn 1 of 2: ${TITLE}`, exact: true })
		.click();
	await inspectSent(page, UPDATED);
	await expect(
		page.getByText("Attachment controls are busy.", { exact: true }),
	).toHaveCount(0);
	await captureThemes(page);
});

test("keeps four expanded snapshots and the send action reachable", async ({
	mete,
}) => {
	const { page } = mete;
	const content = Array.from(
		{ length: 60 },
		(_, index) => `export const item${index} = 'selected local source';`,
	).join("\n");
	await runCommand(page, "METE: Start run");
	await page.locator("textarea.mete-field").fill("Review these snapshots");
	await openFile(page, "sample.ts");
	await editWithoutSaving(page, content);
	for (const count of [1, 2, 3, 4]) {
		await runCommand(page, "METE: Add open file");
		await expect(snapshots(page)).toHaveCount(count);
	}
	await runCommand(page, "METE: Add open file");
	await expect(snapshots(page)).toHaveCount(4);
	await expect(draft(page).getByRole("alert")).toBeVisible();
	for (const snapshot of await snapshots(page).all()) {
		await snapshot.locator("summary").click();
		await expect(snapshot.locator("pre")).toHaveText(content);
	}
	const pre = snapshots(page).last().locator("pre");
	await pre.focus();
	const before = await pre.evaluate((element) => element.scrollTop);
	await page.keyboard.press("ArrowDown");
	await expect
		.poll(() => pre.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(before);
	expect(readFileSync(join(mete.dir, "sample.ts"), "utf8")).toBe(DISK);
	await captureThemes(page, ".mete-composer", "drafts");
});
