import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { loadShippedModels } from "../../src/infrastructure/model-data.js";

// The Zen free ids live on 2026-10-21; jev-1.13-free has no published facts and
// does not use the OpenAI chat format, so it has no row.
const ZEN_FREE = [
	"big-pickle",
	"beam-free",
	"mimo-v2.6-flash-free",
	"nemotron-3.5-super-vl-free",
	"nemotron-3.5-lightning-free",
	"longcat-2.5-preview-free",
	"deepseek-v4.1-flash-free",
	"glm-5.3-flash-free",
	"minimax-m3.1-flash-free",
];

describe("shipped models.yaml", () => {
	it("parses, and every row names its source and check date", async () => {
		const data = await loadShippedModels();
		const rows = Object.values(data).flatMap((p) => Object.values(p));
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(r.source).toBeTruthy();
			expect(r.checked).toMatch(/^2026-10-2[12]$/);
		}
	});

	it("covers every OpenCode Zen free model with facts and privacy", async () => {
		const zen = (await loadShippedModels())["opencode-zen"] ?? {};
		expect(Object.keys(zen).sort()).toEqual([...ZEN_FREE].sort());
		for (const r of Object.values(zen)) {
			expect(r.free).toBe(true);
			expect(r.contextWindow).toBeGreaterThan(0);
			expect(r.privacy).toBeDefined();
		}
	});

	it("gives NVIDIA chat models, an embedding model and a rerank model", async () => {
		const nvidia = Object.values((await loadShippedModels()).nvidia ?? {});
		expect(nvidia.some((r) => r.capability === "chat")).toBe(true);
		expect(nvidia.some((r) => r.capability === "embed")).toBe(true);
		expect(nvidia.some((r) => r.capability === "rerank")).toBe(true);
	});

	it("rejects a row with missing facts", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mete-providers-"));
		const file = join(dir, "models.yaml");
		await writeFile(file, "nvidia:\n  m: { capability: chat }\n");
		await expect(loadShippedModels(pathToFileURL(file))).rejects.toThrow();
		await rm(dir, { recursive: true, force: true });
	});
});

describe("Google AI Studio's shipped rows", () => {
	it("name its free chat models with the privacy of its unpaid terms", async () => {
		const google = (await loadShippedModels()).google ?? {};
		expect(Object.keys(google).length).toBeGreaterThan(0);
		for (const [id, r] of Object.entries(google)) {
			expect(id.startsWith("models/")).toBe(false);
			expect(r).toMatchObject({
				capability: "chat",
				free: true,
				toolCalling: true,
				privacy: { trains: true, logs: true, publishes: false },
			});
		}
	});
});

describe("Groq's shipped rows", () => {
	it("name its free chat models with tool calling and the privacy of its data page", async () => {
		const groq = (await loadShippedModels()).groq ?? {};
		expect(Object.keys(groq).sort()).toEqual([
			"openai/gpt-oss-120b",
			"openai/gpt-oss-20b",
		]);
		for (const r of Object.values(groq)) {
			expect(r).toMatchObject({
				capability: "chat",
				free: true,
				toolCalling: true,
				privacy: { trains: false, logs: true, publishes: false },
			});
		}
	});
});
