import type { Locator, Page } from "@playwright/test";
import { expect, runCommand, test } from "./launch.js";

// The onboarding flow of docs/15 (docs/13's Onboarding wizard; ADR-088): the four steps in docs/13's
// order, the built-in providers `mete key list` names with a key row each, and the gate that keeps a
// run from starting until a model provider has a key. The screen reads the key list and writes
// nothing, so no test here touches the developer's keychain; the keys it reads belong to the machine,
// which is why the gate is asserted as an invariant rather than as "no key".

const WAIT = 60_000;
/** The step titles, in docs/13's order; each is a region named by its own title. */
const STEPS = [
	"1. Language",
	"2. Model provider keys",
	"3. Privacy",
	"4. Web search",
];
/** The model providers of `mete key list` (apps/cli/src/application/keys.ts), then the search one. */
const MODEL_PROVIDERS = [
	"nvidia",
	"openrouter",
	"opencode-zen",
	"groq",
	"google",
];

/** Opens the Welcome screen from the palette and waits until its key list has been read. */
const welcomePanel = async (page: Page): Promise<Locator> => {
	await runCommand(page, "METE: Welcome");
	const panel = page
		.locator(".mete-panel")
		.filter({ hasText: "Welcome to METE" });
	await expect(panel).toBeVisible({ timeout: WAIT });
	return panel;
};

/** The key rows of the model providers, one field and one Get a key each. */
const keyRows = async (panel: Locator): Promise<Locator> => {
	const keys = panel.getByRole("region", { name: STEPS[1] });
	await expect(keys).toContainText("Set at least one.", { timeout: WAIT });
	for (const id of MODEL_PROVIDERS)
		await expect(keys.locator(`#mete-welcome-${id}`)).toHaveAttribute(
			"type",
			"password",
			{ timeout: WAIT },
		);
	return keys;
};

test("the onboarding screen shows the steps, the key rows and the start gate", async ({
	mete,
}) => {
	const { page } = mete;
	const panel = await welcomePanel(page);

	for (const step of STEPS)
		await expect(panel.getByRole("region", { name: step })).toBeVisible({
			timeout: WAIT,
		});

	const keys = await keyRows(panel);
	// Every built-in provider keeps the page its key comes from behind Get a key (docs/09).
	const links = keys.getByRole("button", { name: "Get a key" });
	await expect(links).toHaveCount(MODEL_PROVIDERS.length, { timeout: WAIT });
	const pages = await links.evaluateAll((els) =>
		els.map((el) => el.getAttribute("title") ?? ""),
	);
	for (const url of pages) expect(url).toMatch(/^https:\/\//);

	// Web search: Exa searches without a key; Tavily is the optional one (docs/13).
	const search = panel.getByRole("region", { name: STEPS[3] });
	await expect(search).toContainText("Exa MCP searches the web without a key", {
		timeout: WAIT,
	});
	await expect(search.locator("#mete-welcome-tavily")).toHaveAttribute(
		"type",
		"password",
	);

	// The gate of docs/13: a run starts only with a key, and the note says what is missing.
	const start = panel.getByRole("button", { name: "Start a run" });
	await expect(start).toBeVisible({ timeout: WAIT });
	if (await start.isDisabled())
		await expect(
			panel.getByText("Set a model provider's key first."),
		).toBeVisible();
});
