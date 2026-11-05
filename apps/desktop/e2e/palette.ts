import type { Page } from "@playwright/test";

const opens = (wait: Promise<void>) =>
	wait.then(
		() => true,
		() => false,
	);

/** Runs a command from Theia's palette, the keyboard-first way docs/13 asks every METE action to be reachable. */
export const runCommand = async (page: Page, label: string) => {
	const input = page.locator(".quick-input-box input");
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press("Control+Shift+P");
		if (await opens(input.waitFor({ state: "visible", timeout: 5_000 }))) break;
		await page.click("body");
	}
	// The quick input does not take focus by itself, and it filters on real key events only.
	await input.click();
	await page.keyboard.type(label, { delay: 40 });
	await page.keyboard.press("Enter");
};
