import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatChunk } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// The chaos test of docs/15 (release tier, `pnpm test:chaos`): with optional modules left out one
// by one and in seeded random sets, the app still starts and finishes the single-agent fixture
// task, the typo fix of run.test.ts. The fixture's scripted provider always stays: the task needs a
// model, and in this test it stands in for every provider module. CHAOS_SEED repeats a failing set.

const SEED = Number(process.env.CHAOS_SEED ?? 20261023);
const RANDOM_SETS = 5;

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

// mulberry32: a small seeded generator, so a failing set can be run again.
const random = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

// Runs the fixture task in a fresh repository with `without` left out; true when it finished.
const fixture = async (without: readonly string[]) => {
	const repo = await tempRepo({
		"greet.js": 'export const greet = (n) => "Helo " + n;\n',
	});
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: EDIT })],
		without,
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	try {
		const t = recordingIo();
		const code = await runCommand(app.value, t.io, {
			goal: "fix the typo in greet.js",
		});
		const text = await readFile(join(repo.workspaceDir, "greet.js"), "utf8");
		return { code, fixed: text.includes("Hello "), err: t.err };
	} finally {
		await app.value.stop();
		await repo.close();
	}
};

// The optional modules of the app as the CLI composes it, but for the fixture's provider.
const optionalModules = async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: [] })],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	const ids = app.value.modules
		.filter(
			(m) =>
				m.manifest.class === "optional" && m.manifest.id !== "provider-fake",
		)
		.map((m) => m.manifest.id);
	await app.value.stop();
	await repo.close();
	return ids;
};

const sets = (ids: readonly string[]) => {
	const next = random(SEED);
	const picked = Array.from({ length: RANDOM_SETS }, () =>
		ids.filter(() => next() < 0.5),
	);
	return [...ids.map((id) => [id]), ...picked, [...ids]];
};

describe(`chaos (seed ${SEED})`, () => {
	it("finishes the single-agent fixture task with optional modules left out", async () => {
		const ids = await optionalModules();
		expect(ids.length).toBeGreaterThan(0);
		for (const without of sets(ids)) {
			const r = await fixture(without);
			expect({ without, ...r }).toMatchObject({
				without,
				code: 0,
				fixed: true,
			});
		}
	}, 600_000);
});
