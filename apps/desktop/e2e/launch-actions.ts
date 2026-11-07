import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { runCommand } from "./palette.js";

/** Starts a run from the composer, the keyboard-first way docs/13 asks every METE action to be reachable. */
export const startRun = async (
	page: Page,
	{ goal, team }: { readonly goal: string; readonly team: RegExp },
) => {
	await runCommand(page, "METE: Start run");
	const field = page.locator("textarea.mete-field");
	await expect(field).toBeVisible({ timeout: 60_000 });
	const radio = page.getByRole("radio", { name: team });
	const choices = page
		.locator("details")
		.filter({ has: page.locator('input[type="radio"]') });
	if (await choices.count()) await choices.locator("summary").click();
	await expect(radio).toBeVisible({ timeout: 60_000 });
	await field.fill(goal);
	await radio.check();
	await page.getByRole("button", { name: "Start run" }).click();
};

/** The Home inbox's row whose goal opens the run in the Team panel (ADR-110). */
export const inboxLink = (page: Page, goal: string) =>
	page
		.locator('section[aria-label="Waiting for you"]')
		.filter({ has: page.getByTitle("Open in the team panel") })
		.getByTitle("Open in the team panel")
		.filter({ hasText: goal });

/** The file a run's artifact landed in, under `.mete/artifacts/`, once a task wrote it. */
export const artifactPath = (dir: string, name: string): string | undefined => {
	const artifacts = join(dir, ".mete", "artifacts");
	if (!existsSync(artifacts)) return undefined;
	for (const runId of readdirSync(artifacts)) {
		const file = join(artifacts, runId, name);
		if (existsSync(file)) return file;
	}
	return undefined;
};
