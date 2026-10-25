import { meteViolations } from "./axe.js";
import { expect, runCommand, test } from "./launch.js";

// docs/15: no serious or critical axe violation on METE's own panels (the .mete-panel root,
// docs/13's design system); Theia's shell is not METE's to fix here.

test("@a11y the Welcome screen has no serious or critical violation", async ({
	mete,
}) => {
	const { page } = mete;
	await runCommand(page, "METE: Welcome");
	await expect(page.getByText("Welcome to METE")).toBeVisible({
		timeout: 60_000,
	});
	expect(await meteViolations(page)).toEqual([]);
});

test("@a11y the Changes panel has no serious or critical violation", async ({
	mete,
}) => {
	const { page } = mete;
	await runCommand(page, "METE: Open changes");
	await expect(page.getByText("No changes.")).toBeVisible({
		timeout: 60_000,
	});
	expect(await meteViolations(page)).toEqual([]);
});

test.describe("@a11y the Assets panel", () => {
	test.use({
		files: {
			".mete/assets/shot.svg":
				'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3a7"/></svg>',
			".mete/assets/manifest.jsonl": `${JSON.stringify({
				path: ".mete/assets/shot.svg",
				mediaType: "image/svg+xml",
				bytes: 97,
				sha256: "abc",
				server: "demo",
				tool: "render",
				at: "2026-10-25T10:00:00.000Z",
			})}\n`,
		},
	});

	test("has no serious or critical violation", async ({ mete }) => {
		const { page } = mete;
		await runCommand(page, "METE: Open assets");
		await expect(page.getByText("shot.svg")).toBeVisible({ timeout: 60_000 });
		expect(await meteViolations(page)).toEqual([]);
	});
});
