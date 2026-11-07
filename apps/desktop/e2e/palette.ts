import { expect, type Page } from "@playwright/test";

const opens = (wait: Promise<void>) =>
	wait.then(
		() => true,
		() => false,
	);

/** Opens the native command palette after startup/reload keybindings become ready. */
export const openPalette = async (page: Page) => {
	const input = page.locator(".quick-input-box input");
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press("Control+Shift+P");
		if (await opens(input.waitFor({ state: "visible", timeout: 5_000 }))) break;
		await page.click("body");
	}
	return input;
};

/** Runs a command from Theia's palette, the keyboard-first way docs/13 asks every METE action to be reachable. */
export const runCommand = async (page: Page, label: string) => {
	const input = await openPalette(page);
	// The quick input does not take focus by itself, and it filters on real key events only.
	await input.click();
	await page.keyboard.type(label, { delay: 40 });
	const command = page.getByRole("option").filter({ hasText: label }).first();
	await expect(command).toBeVisible();
	await command.click();
};
