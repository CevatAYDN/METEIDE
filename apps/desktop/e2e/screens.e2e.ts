import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { meteViolations } from "./axe.js";
import { expect, runCommand, test } from "./launch.js";

test.use({
	script: {
		turns: [
			[
				{ type: "text", text: "Offline screen fixture" },
				{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
			],
		],
	},
});

// The renderer under sandbox and CSP (ADR-175): every METE screen opens, axe finds no serious or
// critical violation (docs/15, Accessibility), and the console shows no CSP refusal or failed fetch.
// With METE_AUDIT_OUT set, a screenshot and the panel HTML of each screen are kept there for a design
// review (the Impeccable detector attaches over the app's CDP port, see docs/15).

const SCREENS: readonly [string, string][] = [
	["welcome", "METE: Welcome"],
	["home", "METE: Open home"],
	["start-run", "METE: Start run"],
	["team", "METE: Open team panel"],
	["quota", "METE: Open quota dashboard"],
	["settings", "METE: Show settings"],
	["memory", "METE: Open memory"],
	["assets", "METE: Open assets"],
	["audit-log", "METE: Open audit log"],
	["changes", "METE: Open changes"],
	["waiting", "METE: Show what waits for you"],
];

const BLOCKED = /Content Security Policy|Failed to fetch|sandbox/i;

const keep = async (
	out: string | undefined,
	id: string,
	page: Parameters<typeof meteViolations>[0],
) => {
	if (!out) return;
	await page.screenshot({ path: join(out, `${id}.png`) });
	const html = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>(".mete-panel")]
			.filter((p) => p.offsetWidth || p.offsetHeight)
			.map((p) => p.outerHTML)
			.join("\n"),
	);
	writeFileSync(join(out, `${id}.html`), html);
};

test("every METE screen opens under the CSP without violations", async ({
	mete,
}) => {
	test.setTimeout(600_000);
	const out = process.env.METE_AUDIT_OUT;
	if (out) mkdirSync(out, { recursive: true });
	const { page } = mete;
	const errors: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
	const violations: Record<string, unknown[]> = {};
	for (const [id, command] of SCREENS) {
		await runCommand(page, command);
		await page.waitForTimeout(2000);
		await keep(out, id, page);
		const found = await meteViolations(page);
		if (found.length > 0) violations[id] = found;
	}
	expect(violations).toEqual({});
	expect(errors.filter((e) => BLOCKED.test(e))).toEqual([]);
});
