import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openFile, replaceFile } from "./ide-interactions.js";
import { expect, runCommand, test } from "./launch.js";

const INITIAL = "export const message = 'initial';\n";
const EDITED = "export const message = 'edited-by-user';\n";
test.use({
	files: { "sample.ts": INITIAL },
	commit: true,
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const terminalMarker = async (
	page: Parameters<typeof runCommand>[0],
	dir: string,
) => {
	await runCommand(
		page,
		"Terminal: Create New Integrated Terminal from a Profile",
	);
	await expect(
		page.getByRole("textbox", {
			name: "Select a profile for the new terminal",
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("option")
		.filter({ hasNotText: "JavaScript Debug Terminal" })
		.first()
		.click();
	const terminal = page.locator(".xterm-helper-textarea").last();
	await expect(terminal).toBeVisible();
	await terminal.focus();
	await page.keyboard.type(
		"node -e \"require('fs').writeFileSync('terminal-marker.txt','terminal ready')\"",
	);
	await page.keyboard.press("Enter");
	await expect
		.poll(() => existsSync(join(dir, "terminal-marker.txt")))
		.toBe(true);
	expect(readFileSync(join(dir, "terminal-marker.txt"), "utf8")).toBe(
		"terminal ready",
	);
};

test("native editing, search, terminal and change review preserve workspace navigation", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await openFile(page, "sample.ts");
	await replaceFile(page, EDITED);
	await expect
		.poll(() => readFileSync(join(dir, "sample.ts"), "utf8"))
		.toBe(EDITED);
	await page.keyboard.press("Control+Shift+f");
	const search = page.locator("#search-input-field");
	await search.fill("edited-by-user");
	await search.press("Enter");
	await expect(page.locator("#search-in-workspace")).toContainText("sample.ts");
	await terminalMarker(page, dir);
	await page.keyboard.press("Control+Shift+g");
	const scm = page.locator("#scm-view-container");
	await expect(scm).toContainText("sample.ts", { timeout: 60_000 });
	await scm.getByText("sample.ts", { exact: true }).click();
	await expect(page.locator(".monaco-diff-editor")).toBeVisible();
	await runCommand(page, "METE: Open changes");
	const changes = page.locator(".mete-changes");
	await changes.getByRole("button").filter({ hasText: "sample.ts" }).click();
	await expect(changes).toContainText("edited-by-user");
	await changes.getByRole("button", { name: "Open file", exact: true }).click();
	await expect(page.locator(".monaco-editor").first()).toContainText(
		"edited-by-user",
	);
	await page.screenshot({
		path: test.info().outputPath("native-workflow.png"),
	});
});
