import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { chooseTheme } from "./ide-interactions.js";
import { expect, startRun, test } from "./launch.js";

const POLICY = "autonomy: 1\n";
const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: parallel-controls, name: Parallel controls, version: 1.0.0 }
pattern: parallel_then_synthesize
roles:
  - { id: writer, name: Writer, goal: Write one file, tier: coder, capabilities: [fs.write@1] }
tasks:
  - { id: alpha, role: writer, title: Write Alpha }
  - { id: beta, role: writer, title: Write Beta }
`;
const say = (text: string) => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
];
const write = (name: string, id = name) => [
	{
		type: "tool-call",
		id,
		name: "fs_write",
		args: { path: `${name}.txt`, content: name },
	},
	{ type: "finish", reason: "tool-calls", usage: { prompt: 1, completion: 1 } },
];
test.use({
	files: {
		"README.md": "# Parallel task control fixture\n",
		".mete/policy.yaml": POLICY,
		".mete/teams/parallel-controls.yaml": TEAM,
	},
	commit: true,
	script: {
		turns: [
			write("alpha"),
			write("beta"),
			say("Beta done"),
			write("alpha", "alpha-again"),
			say("Alpha done"),
		],
	},
});

const themeChecks = async (page: Page, controls: Locator, beta: Locator) => {
	const cdp = await page.context().newCDPSession(page);
	for (const theme of [
		"Light (Theia)",
		"Dark (Theia)",
		"High Contrast (Theia)",
	]) {
		await chooseTheme(page, theme);
		for (const width of [1366, 700]) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: 900,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
			await beta
				.getByRole("button", { name: "Allow once", exact: true })
				.click({ trial: true });
			const size = await controls.evaluate((element) => ({
				width: element.clientWidth,
				scroll: element.scrollWidth,
			}));
			expect(size.scroll).toBeLessThanOrEqual(size.width + 2);
			await page.screenshot({
				path: test.info().outputPath(`task-decisions-${theme}-${width}.png`),
			});
		}
	}
	await chooseTheme(page, "Light (Theia)");
	expect(await meteViolations(page)).toEqual([]);
};

test("exact task permissions work out of order across themes and narrow panels", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await startRun(page, {
		goal: "Write two independent files",
		team: /Parallel controls/i,
	});
	const controls = page.getByRole("region", {
		name: "Task decisions",
		exact: true,
	});
	await expect(controls.locator(".mete-task-request")).toHaveCount(2, {
		timeout: 90_000,
	});
	const alpha = controls.locator(".mete-task-request").filter({
		has: page.getByRole("heading", { name: "Write Alpha", exact: true }),
	});
	const beta = controls.locator(".mete-task-request").filter({
		has: page.getByRole("heading", { name: "Write Beta", exact: true }),
	});
	await expect(alpha).toContainText("alpha.txt");
	await expect(beta).toContainText("beta.txt");
	expect(existsSync(join(dir, "alpha.txt"))).toBe(false);
	expect(existsSync(join(dir, "beta.txt"))).toBe(false);
	await themeChecks(page, controls, beta);
	await beta.getByRole("button", { name: "Allow once", exact: true }).click();
	await expect
		.poll(() => existsSync(join(dir, "beta.txt")), { timeout: 60_000 })
		.toBe(true);
	expect(readFileSync(join(dir, "beta.txt"), "utf8")).toBe("beta");
	expect(existsSync(join(dir, "alpha.txt"))).toBe(false);
	await expect(alpha).toBeVisible();
	await expect(beta).toHaveCount(0);
	await alpha
		.getByRole("button", { name: "Allow for this task", exact: true })
		.click();
	await expect(
		page.locator(".mete-chip").filter({ hasText: "Done" }).first(),
	).toBeVisible({ timeout: 90_000 });
	expect(readFileSync(join(dir, "alpha.txt"), "utf8")).toBe("alpha");
	expect(readFileSync(join(dir, ".mete", "policy.yaml"), "utf8")).toBe(POLICY);
	await expect(controls.locator(".mete-task-request")).toHaveCount(0);
});
