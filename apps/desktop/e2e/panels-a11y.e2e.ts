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
