import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pick } from "./ide-interactions.js";
import { expect, runCommand, test } from "./launch.js";

const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: offline-editor, name: Offline editor, version: 1.0.0 }
pattern: pipeline
roles:
  - id: writer
    name: Writer
    goal: Write an offline fixture
    tier: coder
    capabilities: []
  - id: reviewer
    name: Reviewer
    goal: Review an offline fixture
    tier: reasoning
    capabilities: []
tasks:
  - id: write
    role: writer
    title: Write the fixture
    approval: human
    verify:
      - run: echo before
      # retained capability arguments
      - capability: shell.exec@1
        args: { command: echo gate }
      - run: echo after
`;
test.use({
	files: { ".mete/teams/offline-editor.yaml": TEAM },
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const openTeam = async (page: Parameters<typeof runCommand>[0]) => {
	await runCommand(page, "METE: Edit team");
	await pick(page, "Offline editor");
	await expect(page.locator(".mete-team")).toBeVisible();
	await page
		.locator(".mete-team")
		.getByRole("tab", { name: "Tasks", exact: true })
		.click();
	const advanced = page
		.getByText("Advanced: verify, review and best-of-N", { exact: true })
		.first();
	await advanced.click();
	await page.screenshot({ path: test.info().outputPath("advanced-open.png") });
};

test("advanced team choices save and reopen without losing capability checks", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await openTeam(page);
	const pair = page.getByLabel(/^Reviewed first by \(optional\)/);
	await expect(pair).toBeVisible();
	await pair.selectOption("reviewer");
	await page.getByLabel("Attempts", { exact: true }).fill("2");
	await page
		.locator(".mete-team")
		.getByRole("button", { name: "Save", exact: true })
		.click();
	const file = join(dir, ".mete", "teams", "offline-editor.yaml");
	await expect
		.poll(() => readFileSync(file, "utf8"))
		.toContain("pair_with: reviewer");
	const saved = readFileSync(file, "utf8");
	expect(saved).toContain("args: { command: echo gate }");
	expect(saved).toContain("# retained capability arguments");
	expect(saved.indexOf("echo before")).toBeLessThan(
		saved.indexOf("shell.exec@1"),
	);
	expect(saved.indexOf("shell.exec@1")).toBeLessThan(
		saved.indexOf("echo after"),
	);
	await openTeam(page);
	await expect(page.getByLabel(/^Reviewed first by \(optional\)/)).toHaveValue(
		"reviewer",
	);
	await expect(page.getByLabel("Attempts", { exact: true })).toHaveValue("2");
	await page.screenshot({ path: test.info().outputPath("advanced-team.png") });
});
