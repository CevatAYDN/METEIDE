import { chooseTheme } from "./ide-interactions.js";
import { expect, runCommand, test } from "./launch.js";

test.use({
	script: {
		turns: [
			[
				{ type: "text", text: "Composer fixture completed." },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

test("the compact composer keeps model, tools and Start reachable at desktop and narrow widths", async ({
	mete,
}) => {
	const { page } = mete;
	await runCommand(page, "METE: Start run");
	const goal = page.locator("textarea.mete-field");
	await expect(goal).toBeFocused({ timeout: 60_000 });
	await goal.fill("A deliberately long workspace request ".repeat(15));
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
				height: 768,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
			const composer = page.locator(".mete-composer");
			await expect(
				composer.getByRole("checkbox", { name: "Web", exact: true }),
			).toBeVisible();
			await composer
				.getByRole("button", { name: "Start run", exact: true })
				.click({ trial: true });
			const sizing = await composer.evaluate((element) => ({
				width: element.clientWidth,
				scroll: element.scrollWidth,
			}));
			expect(sizing.scroll).toBeLessThanOrEqual(sizing.width + 2);
			await page.screenshot({
				path: test.info().outputPath(`composer-${theme}-${width}.png`),
			});
		}
	}
	await goal.focus();
	await page.keyboard.press("Control+Enter");
	await expect(page.locator(".mete-chat-assistant")).toContainText(
		"Composer fixture completed.",
		{ timeout: 60_000 },
	);
});
