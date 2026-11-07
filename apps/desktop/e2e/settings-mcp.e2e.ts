import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./launch.js";

// The MCP servers card's Test (ADR-164) through the real daemon and mcp-client: a working server
// names its tools, a broken one says why, and a saved draft stays pending until activation.

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
const NODE = JSON.stringify(process.execPath);
const MCP = `servers:
  - id: demo
    transport: stdio
    runtime: node
    command: ${NODE}
    args: [${JSON.stringify(FIXTURE)}]
  - id: broken
    transport: stdio
    runtime: node
    command: ${NODE}
    args: ["-e", "console.error('refused'); process.exit(3)"]
`;

// A narrow window wraps the answers: no sideways scroll hides a tool or a reason.
const fitsNarrow = async (page: Page, card: Locator, row: Locator) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 760,
		height: 1200,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await expect(row.locator(".mete-tool-status")).toBeVisible();
	await expect(row.locator(".mete-tool-status")).toHaveText(
		"Saved; pending activation",
	);
	await expect(
		row.getByRole("button", { name: "Connect later", exact: true }),
	).toBeEnabled();
	await expect(row.locator(".mete-mcp-answer")).toBeEmpty();
	const [client, scroll] = await card.evaluate((e) => [
		e.clientWidth,
		e.scrollWidth,
	]);
	expect(scroll).toBeLessThanOrEqual(client + 2);
	await card.screenshot({ path: test.info().outputPath("card-narrow.png") });
};

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
	return page.getByRole("region", { name: "MCP servers" });
};

const testLoadedServers = async (card: Locator) => {
	const demo = rowOf(card, "demo");
	await expect(demo.locator(".mete-tool-status")).toHaveText("Not tested");
	await demo.getByText("Advanced", { exact: true }).click();
	await demo.getByRole("button", { name: "Connect demo", exact: true }).click();
	await expect(demo.locator(".mete-tool-status")).toHaveText("Connected", {
		timeout: 60_000,
	});
	await expect(demo.locator(".mete-mcp-answer")).toContainText("Tools (");
	await expect(demo.locator(".mete-mcp-answer")).toContainText("echo");
	const broken = rowOf(card, "broken");
	await broken.getByText("Advanced", { exact: true }).click();
	await broken
		.getByRole("button", { name: "Connect broken", exact: true })
		.click();
	await expect(broken.locator(".mete-mcp-answer")).toContainText(
		"MCP server broken",
		{ timeout: 60_000 },
	);
	await expect(broken.locator(".mete-tool-status")).toHaveText(
		"Connection failed",
	);
};

const savePendingServer = async (page: Page, card: Locator) => {
	await card.getByRole("button", { name: "Add server" }).click();
	await card
		.getByRole("button", { name: "Advanced setup", exact: true })
		.click();
	const later = card.locator(".mete-tool-row").last();
	await later.getByLabel("Server id", { exact: true }).fill("later");
	await later.getByLabel("Transport", { exact: true }).selectOption("stdio");
	await later.getByLabel("Runtime", { exact: true }).selectOption("node");
	await later.getByLabel("Command", { exact: true }).fill(process.execPath);
	await later.getByLabel("Arguments, one per line").fill(FIXTURE);
	await expect(
		later.getByRole("button", { name: "Test later", exact: true }),
	).toHaveCount(0);
	await expect(later.locator(".mete-tool-status")).toHaveText(
		"Unsaved changes",
	);
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(later.locator(".mete-tool-status")).toHaveText(
		"Saved; pending activation",
	);
	await expect(later.locator(".mete-mcp-answer")).toBeEmpty();
	await expect(
		later.getByRole("button", { name: "Connect later", exact: true }),
	).toBeEnabled();
	return later;
};

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

test("the MCP card tests loaded servers and leaves ordinary saves pending activation", async ({
	mete,
}) => {
	const { page } = mete;
	const card = await openTools(page);
	await testLoadedServers(card);
	const later = await savePendingServer(page, card);
	await card.screenshot({ path: test.info().outputPath("card.png") });
	await fitsNarrow(page, card, later);
});
