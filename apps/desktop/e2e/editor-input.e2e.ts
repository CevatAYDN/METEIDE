import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openFile, replaceFile } from "./ide-interactions.js";
import { expect, test } from "./launch.js";

const SOURCE = [
	"console",
	"",
	"export function fixture() {",
	"  const message = 'fixed';",
	"",
	"  return message;",
	"}",
	"",
].join("\n");

test.use({
	files: {
		"sample.ts": "export const fixture = 'initial';\n",
		".vscode/settings.json": JSON.stringify({
			"editor.acceptSuggestionOnEnter": "on",
			"editor.quickSuggestions": true,
			"editor.quickSuggestionsDelay": 0,
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

test("native replacement preserves exact source bytes with completions enabled", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await openFile(page, "sample.ts");
	const lines = page.locator(".monaco-editor:visible .view-lines").first();
	await lines.click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type("cons");
	await expect(lines).toContainText("cons");
	await page.keyboard.press("Control+Space");
	const suggestions = page.locator(".suggest-widget:visible");
	await expect(suggestions).toBeVisible({ timeout: 60_000 });
	await expect(
		suggestions
			.getByRole(process.platform === "win32" ? "listitem" : "option", {
				name: /^console\b/,
			})
			.first(),
	).toBeVisible({ timeout: 60_000 });

	await replaceFile(page, SOURCE);
	await expect
		.poll(() => readFileSync(join(dir, "sample.ts")))
		.toEqual(Buffer.from(SOURCE, "utf8"));
});
