import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KnowledgeSearchOutput, ToolAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// knowledge.search@1 (docs/11, Hybrid search; ADR-149) through the real modules: the vault's notes
// are listed by the real fs.glob@1 (ripgrep, which follows .gitignore) and read by the real
// fs.read@1, which refuses what .meteignore names.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

describe("knowledge search", () => {
	it("finds a workspace vault note, never one .meteignore names", async () => {
		const repo = await tempRepo({
			".meteignore": ".mete/knowledge/decisions/\n",
		});
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script: [] })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const note = async (path: string, text: string) => {
			const file = join(repo.workspaceDir, ".mete", "knowledge", path);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, text);
		};
		await note(
			"lessons/kahve.md",
			"---\ntype: lesson\ntitle: Kahve\n---\n\nŞubat fiyatı 85 TL.\n",
		);
		await note("decisions/gizli.md", "Şubat kararı.\n");
		const tool =
			app.value.registry.resolve<ToolAdapter<unknown, KnowledgeSearchOutput>>(
				"knowledge.search@1",
			);
		if (!tool.ok) throw new Error(JSON.stringify(tool.error));
		const r = await tool.value[0].impl.run(
			{ query: "subat" },
			{ signal: new AbortController().signal },
		);
		expect(r.ok && r.value.results.map((h) => [h.path, h.title])).toEqual([
			["lessons/kahve.md", "Kahve"],
		]);
	});
});
