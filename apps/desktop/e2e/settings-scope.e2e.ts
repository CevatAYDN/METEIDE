import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./launch.js";

test("Settings saves and applies the selected global scope", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await page.locator('[id="status-bar-mete-screens-settings"]').click();
	const panel = page
		.locator(".mete-panel")
		.filter({ hasText: "As METE loaded them at" });
	const global = panel.getByRole("button", { name: "All folders" });
	await expect(global).toBeEnabled({ timeout: 60_000 });
	await global.click();
	await expect(global).toHaveAttribute("aria-pressed", "true");

	const gateway = panel.getByRole("region", { name: "Models and daily spend" });
	await gateway.getByLabel("Daily spending cap (US dollars)").fill("2");
	await expect(
		panel.getByRole("region", { name: "Save changes" }),
	).toContainText("Unsaved changes: gateway");
	const globalFile = await gateway
		.locator(".mete-form-saves")
		.getAttribute("title");
	if (!globalFile)
		throw new Error("Settings did not show the global file path");

	await panel.getByRole("button", { name: "Save changes" }).click();
	await expect(gateway).toContainText("Saved to");
	expect(readFileSync(globalFile, "utf8")).toContain("dailySpendUsd: 2");
	expect(existsSync(join(dir, ".mete", "gateway.yaml"))).toBe(false);

	await panel.getByRole("button", { name: "Apply now" }).click();
	await expect(
		gateway.locator(".mete-settings-file > pre").last(),
	).toContainText("dailySpendUsd: 2", { timeout: 60_000 });
});
