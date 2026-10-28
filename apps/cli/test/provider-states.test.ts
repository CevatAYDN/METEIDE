import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCustomModule } from "@mete/providers";
import { afterEach, describe, expect, it } from "vitest";
import { providerStates } from "../src/application/provider-states.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, silent, tempRepo } from "./helpers.js";

// The custom endpoints among the providers' states (ADR-154): each endpoint of the providers section
// by its provider id, after the provider modules, with the states the modules have.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const SETTINGS = `privacy:
  allowTraining: true
providers:
  custom:
    - { slug: lab, name: Lab, baseUrl: "https://lab.test/v1", format: openai-chat }
    - { slug: shy, name: Shy, baseUrl: "https://shy.test/v1", format: openai-chat }
models:
  custom:lab:
    lab-model: { capability: chat, contextWindow: 128000, toolCalling: true, vision: false, free: true, family: lab }
`;

describe("the providers' states", () => {
	it("lists each custom endpoint: ready with its key, no_key without one", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(repo.globalDir, { recursive: true });
		await writeFile(join(repo.globalDir, "settings.yaml"), SETTINGS);
		const fetch = async () => Response.json({ data: [{ id: "lab-model" }] });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets({ "providers/custom:lab/apiKey": "k" }),
			providers: [createCustomModule({ fetch })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		expect(await providerStates(app.value, () => undefined)).toEqual([
			{ id: "custom:lab", state: "ready" },
			{ id: "custom:shy", state: "no_key" },
		]);
		const spent = "2999-01-01T00:00:00.000Z";
		const until = (id: string) => (id === "custom:lab" ? spent : undefined);
		expect((await providerStates(app.value, until))[0]).toEqual({
			id: "custom:lab",
			state: "exhausted",
			resetsAt: spent,
		});
	});
});
