import type { Page } from "@playwright/test";
import { expect, runCommand, test } from "./launch.js";
import {
	OFFLINE_EXTENSION,
	type OfflineRegistry,
	startOfflineRegistry,
} from "./openvsx-fixture.js";

// Use the real native backend, not page.route: catalog requests originate in Node.
// The shared launcher inherits this environment and isolates the user's profiles.
let registry: OfflineRegistry;
let previousRegistry: string | undefined;

test.beforeAll(async () => {
	previousRegistry = process.env.VSX_REGISTRY_URL;
	registry = await startOfflineRegistry();
	process.env.VSX_REGISTRY_URL = registry.url;
});

test.afterAll(async () => {
	if (previousRegistry === undefined) delete process.env.VSX_REGISTRY_URL;
	else process.env.VSX_REGISTRY_URL = previousRegistry;
	await registry?.close();
});

test.beforeEach(() => {
	registry.requests.length = 0;
	registry.unexpected.length = 0;
});

test.afterEach(async () => {
	await test.info().attach("openvsx-requests", {
		body: JSON.stringify(registry.requests, null, 2),
		contentType: "application/json",
	});
	expect(registry.unexpected).toEqual([]);
});

test.use({
	files: {
		".mete/mcp.yaml": "servers: []\n",
		".vscode/extensions.json": JSON.stringify({
			recommendations: [OFFLINE_EXTENSION.id],
		}),
	},
	script: {
		turns: [
			[
				{ type: "text", text: "Offline fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const nativeView = (page: Page) =>
	page.locator("#vsx-extensions-view-container");
const searchInput = (page: Page) =>
	nativeView(page).getByPlaceholder("Search Open VSX Registry", {
		exact: true,
	});

const openFromSettings = async (page: Page) => {
	await page.locator('[id="status-bar-mete-screens-settings"]').click();
	await page
		.locator('[aria-label="Settings groups"] button')
		.filter({ hasText: "Tools and web search" })
		.click();
	await page
		.getByRole("button", { name: "Editor extensions", exact: true })
		.click();
	await expect(nativeView(page)).toBeVisible();
	await expect(searchInput(page)).toBeFocused();
};

const openFromKeyboard = async (page: Page) => {
	// Focus a different widget so the native toggle reveals rather than hides.
	await runCommand(page, "METE: Start run");
	await expect(page.locator("textarea.mete-field")).toBeFocused({
		timeout: 60_000,
	});
	await page.keyboard.press("Control+Shift+X");
	await expect(nativeView(page)).toBeVisible();
	await expect(searchInput(page)).toBeFocused();
};

const expectNoDiscovery = async (page: Page) => {
	// Negative evidence is bounded: cover the native 500ms search debounce and
	// 5s recommendation notification timer after the installed list is ready.
	await page.waitForTimeout(6_000);
	expect(registry.requests).toEqual([]);
};

const searchCatalog = async (page: Page, query: string) => {
	await searchInput(page).fill(query);
	await expect
		.poll(() =>
			registry.requests.some(
				(request) =>
					request.path === "/api/-/search" &&
					request.query.query === query &&
					request.query.includeAllVersions === "true",
			),
		)
		.toBe(true);
};

test("Settings opens native Extensions with installed built-ins and no startup discovery", async ({
	mete,
}) => {
	const { page } = mete;
	expect(registry.requests).toEqual([]);
	await openFromSettings(page);
	await runCommand(page, "Extensions: Show Built-in Extensions");
	const builtin = nativeView(page)
		.locator(".theia-vsx-extension")
		.filter({ hasText: "JSON Language Basics" });
	await expect(builtin).toBeVisible({ timeout: 60_000 });
	await expect(
		builtin.getByRole("button", { name: "Install", exact: true }),
	).toHaveCount(0);
	await expect(
		builtin.getByRole("button", { name: "Uninstall", exact: true }),
	).toHaveCount(0);
	await expectNoDiscovery(page);
	await page.screenshot({
		path: test.info().outputPath("extensions-desktop.png"),
	});
});

test("CtrlShiftX focuses native Extensions and its controls fit a narrow desktop", async ({
	mete,
}) => {
	const { page } = mete;
	await openFromKeyboard(page);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 760,
		height: 1000,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await expect(searchInput(page)).toBeInViewport();
	const [client, scroll] = await nativeView(page).evaluate((element) => [
		element.clientWidth,
		element.scrollWidth,
	]);
	expect(scroll).toBeLessThanOrEqual(client + 2);
	await expectNoDiscovery(page);
	await page.screenshot({
		path: test.info().outputPath("extensions-narrow.png"),
	});
});

test("explicit native search reaches only the loopback catalog and displays its result", async ({
	mete,
}) => {
	const { page } = mete;
	await openFromKeyboard(page);
	await expectNoDiscovery(page);
	await searchCatalog(page, OFFLINE_EXTENSION.query);
	const results = page.locator('[id="vsx-extensions:searchResult"]');
	const entry = results.locator(".theia-vsx-extension");
	await expect(entry).toHaveCount(1, { timeout: 60_000 });
	await expect(entry.locator(".name")).toHaveText(OFFLINE_EXTENSION.title);
	await expect(entry).toContainText(OFFLINE_EXTENSION.description);
	await expect(entry.locator(".version")).toHaveText("v1.0.0");
	await expect(
		entry.getByRole("button", { name: "Install", exact: true }),
	).toBeVisible();
	await searchCatalog(page, "mete-no-match-fixture");
	await expect(entry).toHaveCount(0);
});
