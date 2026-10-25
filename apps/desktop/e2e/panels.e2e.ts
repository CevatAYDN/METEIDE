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

// A tool that saves an image under .mete/assets/ notes it in the manifest (packages/mcp); the
// Assets view (docs/13; ADR-114) lists it with its picture and the call that saved it.
const SHOT =
	'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3a7"/></svg>';

test.describe("the Assets panel", () => {
	test.use({
		files: {
			".mete/assets/shot.svg": SHOT,
			".mete/assets/manifest.jsonl": `${JSON.stringify({
				path: ".mete/assets/shot.svg",
				mediaType: "image/svg+xml",
				bytes: SHOT.length,
				sha256: "abc",
				server: "demo",
				tool: "render",
				at: "2026-10-25T10:00:00.000Z",
			})}\n`,
		},
	});

	test("lists a saved image with its origin", async ({ mete }) => {
		const { page } = mete;
		await runCommand(page, "METE: Open assets");
		const panel = page.locator(".mete-panel").filter({ hasText: "shot.svg" });
		await expect(panel).toBeVisible({ timeout: 60_000 });
		await expect(panel).toContainText("image/svg+xml");
		await expect(panel).toContainText("demo · render");
		const picture = panel.locator("img").first();
		await expect(picture).toBeVisible();
		// The picture comes from the file itself: a loaded image proves the row previews it.
		await expect
			.poll(() =>
				picture.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0),
			)
			.toBe(true);
	});
});
