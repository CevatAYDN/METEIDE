import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatChunk } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	keyCommand,
	runCommand,
	statusCommand,
	stopCommand,
} from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	type Behaviour,
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// Every real Phase 1 module in one process; only the provider behind the gateway is scripted.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const EDIT: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "fs_edit",
			args: { path: "greet.js", oldStr: "Helo", newStr: "Hello" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Fixed the typo in greet.js." }, finish("stop")],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const setup = async (b?: Behaviour) => {
	const repo = await tempRepo({
		"greet.js": 'export const greet = (n) => "Helo " + n;\n',
	});
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: b ? [scriptedProvider(b)] : [],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	close = async () => {
		await app.value.stop();
		await repo.close();
	};
	return { repo, app: app.value };
};

describe("mete run", () => {
	it("finishes an edit task in a repository through every real module", async () => {
		const { repo, app } = await setup({ script: EDIT });
		const t = recordingIo();
		expect(
			await runCommand(app, t.io, { goal: "fix the typo in greet.js" }),
		).toBe(0);
		expect(await readFile(join(repo.workspaceDir, "greet.js"), "utf8")).toBe(
			'export const greet = (n) => "Hello " + n;\n',
		);
		expect(t.out[0]).toMatch(/^run [0-9a-f-]{36} started$/);
		expect(t.out).toEqual(
			expect.arrayContaining([
				"model fake/coder-1",
				"tool  fs.edit@1",
				"completed\nFixed the typo in greet.js.",
			]),
		);
		expect(
			t.out.some((l) => l.startsWith("checkpoint refs/mete/checkpoints/")),
		).toBe(true);
		const refs = await repo.git(
			"for-each-ref",
			"--format=%(refname)",
			"refs/mete/",
		);
		expect(refs.split("\n")).toHaveLength(1);
		const s = recordingIo();
		expect(await statusCommand(app, s.io)).toBe(0);
		expect(s.out[0]).toMatch(/completed\s+fix the typo in greet\.js$/);
	});

	it("says which capability is missing when no provider is active", async () => {
		const { app } = await setup();
		const t = recordingIo();
		expect(await runCommand(app, t.io, { goal: "anything" })).toBe(1);
		expect(t.err).toEqual(
			expect.arrayContaining([
				"core-engine is not active.",
				"gateway waits for provider.chat@1",
				"core-engine waits for llm.chat@1",
			]),
		);
	});

	it("cancels the run on Ctrl+C and exits 1", async () => {
		const { app } = await setup({ hang: true });
		const t = recordingIo();
		const running = runCommand(app, t.io, { goal: "wait" });
		await vi.waitFor(() => expect(t.out.length).toBeGreaterThan(0));
		t.interrupt();
		expect(await running).toBe(1);
		expect(t.out.at(-1)).toBe("cancelled");
	});
});

describe("mete stop and mete key", () => {
	it("leaves a run paused with exit 2, then mete stop --all cancels it", async () => {
		const { app } = await setup({ noModels: true });
		const t = recordingIo();
		expect(await runCommand(app, t.io, { goal: "g" })).toBe(2);
		expect(t.out.at(-1)).toBe("paused: no_model");
		expect(t.err[0]).toMatch(
			/^Resume it with: mete run --resume [0-9a-f-]{36}$/,
		);
		const s = recordingIo();
		expect(await stopCommand(app, s.io, "all")).toBe(0);
		expect(s.out[0]).toMatch(/ cancelled$/);
		const again = recordingIo();
		expect(await statusCommand(app, again.io)).toBe(0);
		expect(again.out[0]).toMatch(/cancelled\s+g$/);
	});

	it("stores, lists and deletes a key without taking it from argv", async () => {
		const secrets = memorySecrets();
		const t = recordingIo("sk-test");
		expect(await keyCommand(secrets, t.io, "set", "openrouter")).toBe(0);
		expect(await secrets.get("providers/openrouter/apiKey")).toEqual({
			ok: true,
			value: "sk-test",
		});
		const l = recordingIo();
		expect(await keyCommand(secrets, l.io, "list", undefined)).toBe(0);
		expect(l.out).toContain("openrouter     key set");
		expect(l.out.join("\n")).not.toContain("sk-test");
		expect(
			await keyCommand(secrets, recordingIo().io, "delete", "openrouter"),
		).toBe(0);
		expect(
			await keyCommand(secrets, recordingIo().io, "set", "evil/../x"),
		).toBe(1);
		expect(await keyCommand(secrets, recordingIo("").io, "set", "nvidia")).toBe(
			1,
		);
	});
});
