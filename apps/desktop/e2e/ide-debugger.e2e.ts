import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openFile, WORKSPACE_FOLDER } from "./ide-interactions.js";
import { expect, test } from "./launch.js";

const PROGRAM = [
	"const fs = require('node:fs');",
	"let total = 40;",
	"total += 2;",
	"total += 1;",
	"fs.writeFileSync('debug-finished.txt', String(total));",
	"",
].join("\n");
test.use({
	files: {
		"debug-fixture.cjs": PROGRAM,
		".vscode/launch.json": JSON.stringify({
			version: "0.2.0",
			configurations: [
				{
					name: "METE Offline Debug",
					type: "node",
					request: "launch",
					program: join(WORKSPACE_FOLDER, "debug-fixture.cjs"),
					cwd: WORKSPACE_FOLDER,
					runtimeExecutable: process.execPath,
					console: "internalConsole",
					skipFiles: ["<node_internals>/**"],
				},
			],
		}),
	},
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

test("native debugger stops at a breakpoint, steps variables and continues the program", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await openFile(page, "debug-fixture.cjs");
	await page.keyboard.press("Control+g");
	await page.locator(".quick-input-box input").fill(":3");
	await page.keyboard.press("Enter");
	await expect(page.locator(".quick-input-widget")).not.toBeVisible();
	await page.keyboard.press("F9");
	await page.keyboard.press("F5");
	const variables = page.locator('[id^="debug:variables:"]');
	await expect(variables).toContainText(/total.*40/s, { timeout: 60_000 });
	expect(existsSync(join(dir, "debug-finished.txt"))).toBe(false);
	await page.keyboard.press("F10");
	await expect(variables).toContainText(/total.*42/s);
	await page.screenshot({
		path: test.info().outputPath("debugger-paused.png"),
	});
	await page.keyboard.press("F5");
	await expect
		.poll(() => existsSync(join(dir, "debug-finished.txt")))
		.toBe(true);
	expect(readFileSync(join(dir, "debug-finished.txt"), "utf8")).toBe("43");
});
