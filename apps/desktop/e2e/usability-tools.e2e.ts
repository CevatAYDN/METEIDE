import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./launch.js";

const EMPTY = "# User tool configuration\nservers: []\n";
const FIXTURE = join(
	process.cwd(),
	"..",
	"..",
	"packages",
	"mcp",
	"test",
	"fixtures",
	"server.mjs",
);
const disk = (dir: string) =>
	readFileSync(join(dir, ".mete", "mcp.yaml"), "utf8");
const rowOf = (card: Locator, id: string) =>
	card.locator(".mete-tool-row").filter({
		has: card.page().getByText(id, { exact: true }),
	});

const openTools = async (page: Page) => {
	await page.locator('[id="status-bar-mete-screens-settings"]').click();
	await page
		.locator('[aria-label="Settings groups"] button')
		.filter({ hasText: "Tools and web search" })
		.click();
	const card = page.getByRole("region", { name: "MCP servers", exact: true });
	await expect(
		card.getByRole("button", { name: "Add server", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	return card;
};

const openSetup = async (card: Locator, mode: string) => {
	await card.getByRole("button", { name: "Add server", exact: true }).click();
	const setup = card.locator(".mete-tool-setup");
	const choice = setup.getByRole("button", { name: mode, exact: true });
	if ((await choice.getAttribute("aria-pressed")) !== "true")
		await choice.click();
	return setup;
};

test.use({
	files: { ".mete/mcp.yaml": EMPTY },
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const validateRemoteFields = async (setup: Locator, dir: string) => {
	const add = setup.getByRole("button", { name: "Add", exact: true });
	await expect(setup.getByLabel("Display id", { exact: true })).toBeFocused();
	await add.click();
	await expect(setup.getByLabel("Display id", { exact: true })).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await setup.getByLabel("Display id", { exact: true }).fill("remote");
	await setup
		.getByLabel("Address", { exact: true })
		.fill("https://example.invalid/mcp");
	await add.click();
	await expect(setup.getByLabel("HTTP mode", { exact: true })).toBeFocused();
	await setup.getByLabel("HTTP mode", { exact: true }).selectOption("sse");
	await setup
		.getByLabel("Address", { exact: true })
		.fill("https://user:secret@example.invalid/mcp");
	await add.click();
	await expect(setup.getByLabel("Address", { exact: true })).toBeFocused();
	expect(disk(dir)).toBe(EMPTY);
};

const rejectDuplicateRemote = async (card: Locator, dir: string) => {
	const setup = await openSetup(card, "Remote URL");
	await setup.getByLabel("Display id", { exact: true }).fill("remote");
	await setup
		.getByLabel("Address", { exact: true })
		.fill("https://example.invalid/other");
	await setup.getByLabel("HTTP mode", { exact: true }).selectOption("sse");
	await setup.getByRole("button", { name: "Add", exact: true }).click();
	await expect(setup.getByRole("alert")).toBeVisible();
	await expect(card.locator(".mete-tool-row")).toHaveCount(1);
	await setup.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(setup).toHaveCount(0);
	expect(disk(dir)).toBe(EMPTY);
};

test("guided URL validation focuses errors and adds only an unsaved draft", async ({
	mete,
}) => {
	const { page, dir } = mete;
	const card = await openTools(page);
	const setup = await openSetup(card, "Remote URL");
	await validateRemoteFields(setup, dir);
	await setup
		.getByLabel("Address", { exact: true })
		.fill("https://example.invalid/mcp");
	await setup.getByRole("button", { name: "Add", exact: true }).click();
	const row = rowOf(card, "remote");
	await expect(row.locator(".mete-tool-status")).toHaveText("Unsaved changes");
	await row.locator("summary").click();
	await expect(row.getByLabel("URL", { exact: true })).toHaveValue(
		"https://example.invalid/mcp",
	);
	expect(disk(dir)).toBe(EMPTY);
	await rejectDuplicateRemote(card, dir);
});

test("local command requires an explicit runtime and preserves argv lines", async ({
	mete,
}) => {
	const { page, dir } = mete;
	const card = await openTools(page);
	const setup = await openSetup(card, "Local command");
	await setup.getByLabel("Display id", { exact: true }).fill("local");
	await setup.getByLabel("Program", { exact: true }).fill(process.execPath);
	await setup
		.getByLabel("Arguments, one per line")
		.fill(`${FIXTURE}\n path with spaces `);
	await setup.getByRole("button", { name: "Add", exact: true }).click();
	await expect(setup.getByLabel("Runtime", { exact: true })).toBeFocused();
	await setup.getByLabel("Runtime", { exact: true }).selectOption("node");
	await setup.getByRole("button", { name: "Add", exact: true }).click();
	const row = rowOf(card, "local");
	await row.locator("summary").click();
	await expect(row.getByLabel("Command", { exact: true })).toHaveValue(
		process.execPath,
	);
	await expect(row.getByLabel("Arguments, one per line")).toHaveValue(
		`${FIXTURE}\n path with spaces `,
	);
	await expect(row.locator(".mete-tool-status")).toHaveText("Unsaved changes");
	expect(disk(dir)).toBe(EMPTY);
});

const importExternalDraft = async (card: Locator, dir: string) => {
	const setup = await openSetup(card, "Import JSON");
	const json = setup.getByLabel("Server JSON", { exact: true });
	const add = setup.getByRole("button", { name: "Add", exact: true });
	await json.fill(
		'{"mcpServers":{"remote":{"url":"https://example.invalid","type":"sse","headers":{"Authorization":"secret"}}}}',
	);
	await add.click();
	await expect(json).toBeFocused();
	await expect(setup.getByRole("alert")).toBeVisible();
	await expect(card.locator(".mete-tool-row")).toHaveCount(0);
	expect(disk(dir)).toBe(EMPTY);
	await json.fill(
		'{"mcpServers":{"remote":{"url":"https://example.invalid","type":"sse"}}}',
	);
	await add.click();
	await expect(rowOf(card, "remote").locator(".mete-tool-status")).toHaveText(
		"Unsaved changes",
	);
};

const importNativeDraft = async (card: Locator) => {
	const setup = await openSetup(card, "Import JSON");
	await setup.getByLabel("Server JSON", { exact: true }).fill(
		JSON.stringify({
			servers: [
				{
					id: "imported",
					transport: "stdio",
					runtime: "node",
					command: process.execPath,
					args: [FIXTURE],
				},
			],
		}),
	);
	await setup.getByRole("button", { name: "Add", exact: true }).click();
	const imported = rowOf(card, "imported");
	await imported.locator("summary").click();
	await expect(imported.getByLabel("Command", { exact: true })).toHaveValue(
		process.execPath,
	);
	await expect(imported.getByLabel("Arguments, one per line")).toHaveValue(
		FIXTURE,
	);
};

test("JSON import rejects unsupported auth and atomically reviews external and native drafts", async ({
	mete,
}) => {
	const { page, dir } = mete;
	const card = await openTools(page);
	await importExternalDraft(card, dir);
	await importNativeDraft(card);
	await expect(card.locator(".mete-tool-row")).toHaveCount(2);
	expect(disk(dir)).toBe(EMPTY);
});

test("Save and connect activates only the explicitly added local fixture", async ({
	mete,
}) => {
	const { page, dir } = mete;
	const card = await openTools(page);
	const setup = await openSetup(card, "Local command");
	await setup.getByLabel("Display id", { exact: true }).fill("demo");
	await setup.getByLabel("Program", { exact: true }).fill(process.execPath);
	await setup.getByLabel("Runtime", { exact: true }).selectOption("node");
	await setup.getByLabel("Arguments, one per line").fill(FIXTURE);
	await setup.getByRole("button", { name: "Add", exact: true }).click();
	const demo = rowOf(card, "demo");
	await expect(demo.locator(".mete-tool-status")).toHaveText("Unsaved changes");
	expect(disk(dir)).toBe(EMPTY);
	await demo
		.getByRole("button", { name: "Save and connect demo", exact: true })
		.click();
	await expect(demo.locator(".mete-tool-status")).toHaveText("Connected", {
		timeout: 60_000,
	});
	await expect(demo.locator(".mete-mcp-answer")).toContainText("echo");
	expect(disk(dir)).toContain("# User tool configuration");
	expect(disk(dir)).toContain("id: demo");
	await expect(
		page.getByRole("button", { name: "Save changes", exact: true }),
	).toBeDisabled();
});
