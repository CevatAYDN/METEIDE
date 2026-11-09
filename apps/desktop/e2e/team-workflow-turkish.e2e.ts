import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { meteViolations } from "./axe.js";
import { pick } from "./ide-interactions.js";
import { expect, type Launch, runCommand, test } from "./launch.js";

test.use({
	files: {
		".gitattributes": "* text=auto eol=lf\n",
		".mete/policy.yaml": "autonomy: 2\n",
		".mete/teams/turkish-team.yaml": `apiVersion: mete/v2
kind: TeamTemplate
metadata: { id: turkish-team, name: "Türkçe takım", version: 1.0.0 }
pattern: single
roles:
  - { id: reviewer, name: "İnceleyen", goal: "Dosyayı incele", tier: coder, capabilities: [] }
tasks:
  - { id: review, role: reviewer, title: "Dosyayı incele" }
`,
		".mete/skills/turkish-review/SKILL.md":
			"---\nname: turkish-review\ndescription: Yerel inceleme\n---\nÖnce kanıtı incele.\n",
	},
	script: {
		turns: [
			[
				{ type: "text", text: "Offline locale fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

const switchLanguage = async (page: Page) => {
	await runCommand(page, "Configure Display Language");
	await pick(page, "Türkçe");
	const loaded = page.waitForEvent("domcontentloaded");
	await page.getByRole("button", { name: "Restart", exact: true }).click();
	await loaded;
	await expect(page.locator("html")).toHaveAttribute("lang", "tr");
	await expect(page.locator("#theia-app-shell")).toBeVisible();
};

const capture = async (page: Page, name: string) => {
	for (const width of [1366, 700]) {
		await page.setViewportSize({ width, height: 900 });
		const panel = page
			.locator(".mete-team:visible, .mete-settings:visible")
			.first();
		expect(
			await panel.evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		).toBe(true);
		expect(await meteViolations(page)).toEqual([]);
		await page.screenshot({
			path: test.info().outputPath(`turkish-${name}-${width}.png`),
		});
	}
	await page.setViewportSize({ width: 1366, height: 900 });
};

const permissions = async ({ page, dir }: Launch) => {
	await runCommand(page, "METE: İzinleri aç");
	const panel = page.locator(".mete-settings");
	await expect(
		panel.getByRole("heading", { name: "İzinler ve onaylar", exact: true }),
	).toBeVisible();
	const actions = panel.getByRole("group", {
		name: "Önce onay isteyen eylemler",
		exact: true,
	});
	await actions
		.getByLabel("Kural kaynağı", { exact: true })
		.selectOption("custom");
	await actions
		.getByRole("checkbox", { name: "Dosya yazma", exact: true })
		.check();
	await panel
		.getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
		.click();
	await expect
		.poll(() => readFileSync(join(dir, ".mete", "policy.yaml"), "utf8"))
		.toContain("fs.write");
	await capture(page, "permissions");
};

const teamAndSkills = async (page: Page) => {
	await runCommand(page, "METE: Takımı düzenle");
	await pick(page, "Türkçe takım");
	const team = page.locator(".mete-team");
	await expect(
		team.getByRole("tab", { name: "Üye", exact: true }),
	).toBeVisible();
	await team.getByRole("tab", { name: "Görevler", exact: true }).click();
	await expect(
		team.getByRole("tabpanel", { name: "Görevler", exact: true }),
	).toBeVisible();
	await team.locator(".mete-team-learning > summary").click();
	await expect(team.locator(".mete-team-learning")).toContainText(
		"onaydan sonra ders kaydet",
	);
	await capture(page, "team");
	await team.getByRole("button", { name: "Beceriler", exact: true }).click();
	const skills = page.locator(".mete-skills");
	await skills.getByRole("button", { name: "Keşfet", exact: true }).click();
	await expect(skills.getByText("Onaysız", { exact: true })).toBeVisible();
	await expect(
		skills.getByRole("button", {
			name: "SKILL.md dosyasını düzenle",
			exact: true,
		}),
	).toBeEnabled();
	await capture(page, "skills");
};

test("native language switching keeps Turkish team, permission and skill controls usable", async ({
	mete,
}) => {
	await switchLanguage(mete.page);
	await permissions(mete);
	await teamAndSkills(mete.page);
});
