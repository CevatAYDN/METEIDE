import { meteViolations } from "./axe.js";
import { expect, startRun, test } from "./launch.js";

const say = (text: string) => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 12, completion: 4 } },
];

test.use({
	script: {
		turns: [
			say("Merhaba! Sana nasil yardim edebilirim?"),
			say("Onceki selamini hatirliyorum."),
		],
	},
});

test("a single agent accepts a second user message in the same visible conversation", async ({
	mete,
}) => {
	const { page } = mete;
	await startRun(page, { goal: "selam", team: /single agent/i });
	const thread = page.getByRole("region", {
		name: "Conversation",
		exact: true,
	});
	await expect(
		thread.getByText("Merhaba! Sana nasil yardim edebilirim?", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	const input = thread.getByRole("textbox", { name: "Message METE" });
	await input.fill("Beni hatirliyor musun?");
	await input.press("Enter");
	await expect(
		thread.getByText("Onceki selamini hatirliyorum.", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(
		thread.getByText("Beni hatirliyor musun?", { exact: true }),
	).toBeVisible();
	await expect(
		thread.getByText("Merhaba! Sana nasil yardim edebilirim?", { exact: true }),
	).toBeVisible();
	await expect(input).toHaveValue("");
	await expect(page.locator("details.mete-chat-details")).not.toHaveAttribute(
		"open",
	);
	await input.fill("Birinci satir");
	await input.press("Shift+Enter");
	await input.press("x");
	await expect(input).toHaveValue("Birinci satir\nx");
	await page.screenshot({ path: test.info().outputPath("conversation.png") });
	expect(await meteViolations(page)).toEqual([]);
});
