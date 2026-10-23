import { join } from "node:path";
import { apiKeyName, createGroqModule } from "@mete/providers";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

// ADR-056 through every real module: the real Groq module behind a fetch fake that refuses every chat
// with 413 and its tokens-per-minute limit, as Groq did in the Phase 4 gate run. No network.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const groqFetch = (chats: string[]) => async (url: RequestInfo | URL) => {
	const u = String(url);
	if (u.endsWith("/openai/v1/models"))
		return Response.json({
			object: "list",
			data: [{ id: "openai/gpt-oss-120b" }, { id: "openai/gpt-oss-20b" }],
		});
	chats.push(u);
	return Response.json(
		{
			error: {
				message:
					"Request too large for model on tokens per minute (TPM): Limit 8000",
				type: "tokens",
				code: "rate_limit_exceeded",
			},
		},
		{ status: 413, headers: { "x-ratelimit-limit-tokens": "8000" } },
	);
};

describe("a request too large for every model (ADR-056)", () => {
	it("learns the limit from the first 413 and pauses the run instead of crashing", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const chats: string[] = [];
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets({ [apiKeyName("groq")]: "k" }),
			providers: [createGroqModule({ fetch: groqFetch(chats) })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		// About 10,000 tokens by the gateway's estimate (characters / 4), above the 8,000 Groq names.
		const goal = `summarize this: ${"lorem ipsum ".repeat(3_400)}`;
		const t = recordingIo();
		expect(await runCommand(app.value, t.io, { goal })).toBe(2);
		expect(t.out.at(-1)).toBe("paused: no_model");
		// One refused call taught the limit; the second Groq model was never asked.
		expect(chats).toHaveLength(1);
	});
});
