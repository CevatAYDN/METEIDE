import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChatChunk, ok, type TeamEngineAdapter } from "@mete/contracts";
import { createCapabilityRegistry, createEventBus } from "@mete/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	keyCommand,
	runCommand,
	statusCommand,
	stopCommand,
} from "../src/application/commands.js";
import { type App, createApp } from "../src/infrastructure/app.js";
import {
	type Behaviour,
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// Every real Phase 1 module in one process; only the provider behind the gateway is scripted.

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

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

describe("mete run with an engine that throws", () => {
	it("reports a cancel that throws on Ctrl+C instead of leaving it unhandled", async () => {
		const registry = createCapabilityRegistry(() => []);
		const engine: TeamEngineAdapter = {
			start: async () => ok({ runId: RUN }),
			pause: async () => ok(undefined),
			resume: async () => ok(undefined),
			cancel: async () => {
				throw new Error("SQLITE_BUSY");
			},
			status: () => ok([]),
		};
		registry.provide("team.engine@1", {
			id: "fake-engine",
			trust: "core",
			features: [],
			impl: engine,
		});
		const app = {
			registry,
			events: createEventBus((e) => {
				throw e;
			}),
			inactive: [],
		} as unknown as App;
		const t = recordingIo();
		void runCommand(app, t.io, { resume: RUN });
		await vi.waitFor(() => expect(t.interrupt).toBeDefined());
		t.interrupt();
		await vi.waitFor(() =>
			expect(t.err).toContain("could not cancel the run: SQLITE_BUSY"),
		);
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

	it("resumes a paused run and refuses an unknown one", async () => {
		const { app } = await setup({ noModels: true });
		const first = recordingIo();
		expect(await runCommand(app, first.io, { goal: "g" })).toBe(2);
		const runId = first.out[0]?.split(" ")[1] ?? "";
		const again = recordingIo();
		expect(await runCommand(app, again.io, { resume: runId })).toBe(2);
		expect(again.out).toEqual(["resumed", "paused: no_model"]);
		const unknown = recordingIo();
		expect(
			await runCommand(app, unknown.io, {
				resume: "00000000-0000-4000-8000-000000000000",
			}),
		).toBe(1);
		expect(unknown.err[0]).toMatch(/^no run /);
	});

	it("explains an approval pause under the built-in policy", async () => {
		const { app } = await setup({
			script: [
				[
					{
						type: "tool-call",
						id: "c1",
						name: "shell_exec",
						args: { command: "pnpm test" },
					},
					finish("tool-calls"),
				],
			],
		});
		const t = recordingIo();
		expect(await runCommand(app, t.io, { goal: "run the tests" })).toBe(2);
		expect(t.out.at(-1)).toBe("paused: approval");
		expect(t.err.join("\n")).toContain('overrides: { "shell.exec@1": 2 }');
	});

	it("leaves a run another process drives alone and points at Ctrl+C", async () => {
		const { repo, app } = await setup({ hang: true });
		const t = recordingIo();
		const running = runCommand(app, t.io, { goal: "wait" });
		await vi.waitFor(() => expect(t.out.length).toBeGreaterThan(0));
		const runId = t.out[0]?.split(" ")[1] ?? "";
		const second = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ hang: true })],
			recover: false,
		});
		if (!second.ok) throw new Error("second app");
		const s = recordingIo();
		expect(await stopCommand(second.value, s.io, runId)).toBe(1);
		expect(s.err[0]).toContain("is running; a running run stops with Ctrl+C");
		await second.value.stop();
		t.interrupt();
		expect(await running).toBe(1);
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
