import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./launch.js";

// The MCP servers card's Test (ADR-164) through the real daemon and mcp-client: a working server
// names its tools, a broken one says why, and a server the daemon has not loaded says so.

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
const fitsNarrow = async (page: Page, card: Locator) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 760,
		height: 1200,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await expect(card.getByRole("status").nth(1)).toBeVisible();
	const [client, scroll] = await card.evaluate((e) => [
		e.clientWidth,
		e.scrollWidth,
	]);
	expect(scroll).toBeLessThanOrEqual(client + 2);
	await card.screenshot({ path: test.info().outputPath("card-narrow.png") });
};

test.describe("the MCP servers card", () => {
	test.use({ files: { ".mete/mcp.yaml": MCP } });

	test("tests each server as METE loaded it", async ({ mete }) => {
		const { page } = mete;
		await page.locator('[id="status-bar-mete-screens-settings"]').click();
		await page
			.locator('[aria-label="Settings groups"] button')
			.filter({ hasText: "Tools and web search" })
			.click();
		const card = page.getByRole("region", { name: "MCP servers" });
		const answers = card.getByRole("status");

		// The button's name is its word and the server's id as typed.
		await card.getByRole("button", { name: "Test demo" }).click();
		await expect(answers.nth(0)).toContainText("Tools (", { timeout: 60_000 });
		await expect(answers.nth(0)).toContainText("echo");

		await card.getByRole("button", { name: "Test broken" }).click();
		await expect(answers.nth(1)).toContainText("MCP server broken", {
			timeout: 60_000,
		});

		await card.getByRole("button", { name: "Add server" }).click();
		await card.getByLabel("Server id").last().fill("later");
		await card.getByRole("button", { name: "Test later" }).click();
		await expect(answers.nth(2)).toContainText(
			"METE has not loaded later: no MCP server later in mcp.yaml.",
			{ timeout: 60_000 },
		);
		await card.screenshot({ path: test.info().outputPath("card.png") });

		await fitsNarrow(page, card);
	});
});
