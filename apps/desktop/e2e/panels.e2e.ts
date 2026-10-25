import { expect, runCommand, test } from "./launch.js";

// The panels every METE surface hangs from (docs/13): the Welcome screen opens, and the Changes
// panel answers through the real daemon of the fresh git workspace.

test("the Welcome screen opens", async ({ mete }) => {
	const { page } = mete;
	await runCommand(page, "METE: Welcome");
	await expect(page.getByText("Welcome to METE", { exact: false })).toBeVisible(
		{ timeout: 60_000 },
	);
});

test("the Changes panel reads an empty working tree", async ({ mete }) => {
	const { page } = mete;
	await runCommand(page, "METE: Open changes");
	await expect(page.getByText("No changes.")).toBeVisible({
		timeout: 60_000,
	});
});
