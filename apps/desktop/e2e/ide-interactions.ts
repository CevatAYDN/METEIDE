import type { Page } from "@playwright/test";
import { expect, runCommand } from "./launch.js";

/** Native task/debug variable; resolution belongs to Theia, not the test process. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: This is Theia's literal configuration variable.
export const WORKSPACE_FOLDER = "${workspaceFolder}";

/** Select an installed native theme without editing user settings on disk. */
export const chooseTheme = async (page: Page, name: string) => {
	await runCommand(page, "Preferences: Color Theme");
	await page.getByText(name, { exact: true }).click();
	await expect(page.locator(".quick-input-widget")).not.toBeVisible();
};

/** Open a workspace file through native Quick Open, without an application test hook. */
export const openFile = async (page: Page, name: string) => {
	await page.keyboard.press("Control+p");
	const input = page.locator(".quick-input-box input");
	await expect(input).toBeVisible();
	await input.fill(name);
	await expect(
		page.getByRole("option").filter({ hasText: name }).first(),
	).toBeVisible();
	await input.press("Enter");
	await expect(input).not.toBeVisible();
	const editor = page.locator(".monaco-editor:visible textarea").first();
	await expect(editor).toBeVisible();
	await editor.focus();
};

/** Replace an isolated fixture through the real editor and save it with its normal keybinding. */
export const replaceFile = async (page: Page, text: string) => {
	await page.locator(".monaco-editor:visible .view-lines").first().click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type(text, { delay: 10 });
	await page.keyboard.press("Control+s");
};

/** Choose one native quick-pick option after a command opens its picker. */
export const pick = async (page: Page, label: string) => {
	const input = page.locator(".quick-input-box input");
	await expect(input).toBeVisible();
	const prefix = (await input.inputValue()).startsWith("task ") ? "task " : "";
	await input.fill(`${prefix}${label}`);
	await expect(
		page.getByRole("option").filter({ hasText: label }).first(),
	).toBeVisible();
	await input.press("Enter");
	await expect(input).not.toBeVisible();
};
