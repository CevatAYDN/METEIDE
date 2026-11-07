import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	openFile,
	pick,
	replaceFile,
	WORKSPACE_FOLDER,
} from "./ide-interactions.js";
import { expect, runCommand, test } from "./launch.js";

const CHECK = [
	"const fs = require('node:fs');",
	"if (fs.readFileSync('sample.txt', 'utf8').includes('broken')) {",
	"  console.error('sample.txt:2:1: error: METE fixture failure');",
	"  process.exitCode = 1;",
	"} else fs.writeFileSync('build-passed.txt', 'passed');",
	"",
].join("\n");
test.use({
	files: {
		"sample.txt": "Fixture\nbroken\n",
		"build-check.cjs": CHECK,
		".vscode/tasks.json": JSON.stringify({
			version: "2.0.0",
			tasks: [
				{
					label: "METE fixture build",
					type: "process",
					command: process.execPath,
					args: ["build-check.cjs"],
					options: { cwd: WORKSPACE_FOLDER },
					presentation: { reveal: "always", panel: "dedicated", clear: true },
					problemMatcher: {
						owner: "mete-fixture",
						fileLocation: ["relative", WORKSPACE_FOLDER],
						pattern: {
							regexp: "^(.*):(\\d+):(\\d+): (error): (.*)$",
							file: 1,
							line: 2,
							column: 3,
							severity: 4,
							message: 5,
						},
					},
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

test("native task errors navigate to source and clear after a successful rebuild", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await runCommand(page, "Task: Run Task...");
	await expect(
		page.getByRole("textbox", { name: "Select the task to run", exact: true }),
	).toBeVisible();
	await pick(page, "METE fixture build");
	await expect(page.locator("#status-bar-problem-marker-status")).toContainText(
		"1",
		{ timeout: 60_000 },
	);
	await page.getByText("Problems", { exact: true }).click();
	const problem = page.getByText(/^METE fixture failure/);
	await expect(problem).toBeVisible({ timeout: 60_000 });
	await expect(problem).toContainText("[Ln 2, Col 1]");
	await problem.dblclick();
	await expect(page.locator(".monaco-editor").first()).toContainText("broken");
	await openFile(page, "sample.txt");
	await replaceFile(page, "Fixture\nfixed\n");
	await expect
		.poll(() => readFileSync(join(dir, "sample.txt"), "utf8"))
		.toBe("Fixture\nfixed\n");
	await runCommand(page, "Task: Rerun Last Task");
	await expect.poll(() => existsSync(join(dir, "build-passed.txt"))).toBe(true);
	await page.getByText("Problems", { exact: true }).click();
	await expect(problem).toHaveCount(0, { timeout: 60_000 });
	await page.screenshot({
		path: test.info().outputPath("task-problems-cleared.png"),
	});
});
