import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, test } from "./launch.js";

const SECRET = "mete-e2e-keychain-sentinel";
const fixture = join(process.cwd(), "e2e", "fixtures", "credential-server.mjs");
const MCP = JSON.stringify({
	servers: [
		{
			id: "credential-demo",
			transport: "stdio",
			runtime: "node",
			command: process.execPath,
			args: [fixture],
			credentialFields: [
				{
					kind: "env",
					name: "METE_TEST_KEY",
					required: true,
					secret: true,
					description: "Fixture access key",
				},
			],
		},
	],
});
test.use({
	files: { ".mete/mcp.yaml": MCP },
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
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
	return card
		.locator(".mete-tool-row")
		.filter({ has: page.getByText("credential-demo", { exact: true }) });
};

const capture = async (page: Page, row: Locator) => {
	const cdp = await page.context().newCDPSession(page);
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const width of [700, 1366]) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: 900,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await row.scrollIntoViewIfNeeded();
			expect(
				await row.evaluate(
					(element) => element.scrollWidth <= element.clientWidth + 2,
				),
			).toBe(true);
			await page.screenshot({
				path: test.info().outputPath(`mcp-credentials-${theme}-${width}.png`),
			});
		}
	}
	await cdp.detach();
};

const configure = async (row: Locator) => {
	await expect(row.getByLabel("METE_TEST_KEY", { exact: true })).toBeVisible();
	const field = row.getByLabel("METE_TEST_KEY", { exact: true });
	await expect(field).toHaveAttribute("type", "password");
	await expect(
		row.getByRole("button", { name: "Connect credential-demo", exact: true }),
	).toBeDisabled();
	await field.fill(SECRET);
	await row
		.getByRole("button", { name: "Save credentials", exact: true })
		.click();
	await expect(field).toHaveValue("");
	await expect(
		row.getByRole("button", { name: "Connect credential-demo", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	await row
		.getByRole("button", { name: "Connect credential-demo", exact: true })
		.click();
	await expect(row.locator(".mete-tool-status")).toHaveText("Connected", {
		timeout: 60_000,
	});
};

test("required tool credentials stay in the keychain across restart and can be forgotten", async ({
	mete,
}) => {
	let page = mete.page;
	let row = await openTools(page);
	await configure(row);
	expect(
		readFileSync(join(mete.dir, ".mete", "mcp.yaml"), "utf8"),
	).not.toContain(SECRET);
	expect(await row.innerText()).not.toContain(SECRET);
	await capture(page, row);
	expect(await meteViolations(page)).toEqual([]);
	page = await mete.restart();
	row = await openTools(page);
	await expect(row.getByLabel("METE_TEST_KEY", { exact: true })).toHaveValue(
		"",
	);
	await expect(
		row.getByRole("button", { name: "Connect credential-demo", exact: true }),
	).toBeEnabled({ timeout: 60_000 });
	await row
		.getByRole("button", { name: "Forget local credentials", exact: true })
		.click();
	await expect(
		row.getByRole("button", { name: "Connect credential-demo", exact: true }),
	).toBeDisabled({ timeout: 60_000 });
});

const addOAuthDraft = async (card: Locator) => {
	await card.getByRole("button", { name: "Add server", exact: true }).click();
	await card
		.getByRole("button", { name: "Advanced setup", exact: true })
		.click();
	const row = card.locator(".mete-tool-row").last();
	await row.getByLabel("Server id", { exact: true }).fill("pre-model");
	await row
		.getByLabel("Transport", { exact: true })
		.selectOption("streamable-http");
	await row
		.getByLabel("URL", { exact: true })
		.fill("https://offline.example/mcp");
	await row.getByLabel("Sign-in", { exact: true }).selectOption("oauth");
	return row;
};

test.describe("tool setup before model configuration", () => {
	test.use({
		files: { ".mete/mcp.yaml": "servers: []\n" },
		script: { turns: [] },
		// Isolates both networking and keychain reads; no real provider can activate.
		web: { pages: { "https://offline.example/fixture": "Offline fixture" } },
	});

	test("applies a new OAuth server without a model provider or automatic login", async ({
		mete,
	}) => {
		const { page } = mete;
		await page.locator('[id="status-bar-mete-screens-settings"]').click();
		await page
			.locator('[aria-label="Settings groups"] button')
			.filter({ hasText: "Tools and web search" })
			.click();
		const card = page.getByRole("region", { name: "MCP servers", exact: true });
		await expect(
			card.getByRole("button", { name: "Add server", exact: true }),
		).toBeEnabled({ timeout: 60_000 });
		const row = await addOAuthDraft(card);
		await page
			.getByRole("button", { name: "Save changes", exact: true })
			.click();
		await page.getByRole("button", { name: "Apply now", exact: true }).click();
		await expect(row.locator(".mete-tool-status")).toHaveText(
			"Sign-in required",
			{ timeout: 60_000 },
		);
		await expect(
			row.getByRole("button", { name: "Sign in", exact: true }),
		).toBeEnabled();
		await expect(
			row.getByRole("button", { name: "Cancel sign-in", exact: true }),
		).toHaveCount(0);
		await row.screenshot({
			path: test.info().outputPath("no-model-oauth-ready.png"),
		});
	});
});
