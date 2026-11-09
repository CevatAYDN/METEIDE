import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SkillTrustAdapter } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { vi } from "vitest";
import { type App, createApp } from "../src/infrastructure/app.js";
import { runLockFile, takeRunLock } from "../src/infrastructure/run-lock.js";
import { memorySecrets, silent, tempRepo } from "./helpers.js";

const OFFLINE = [
	"browser",
	"mcp-client",
	"registry",
	"tools-web",
	"vault",
	"knowledge-search",
];
export const skillText = (name: string, body = "Review this version.") =>
	`---\nname: ${name}\ndescription: Instructions for review\n---\n${body}\n`;

export const skillAppFixture = async () => {
	const repo = await tempRepo({ "readme.txt": "offline fixture\n" });
	const apps = new Set<App>();
	const releases = new Set<() => Promise<void>>();
	const fetch = vi.fn<typeof globalThis.fetch>(async () => {
		throw new Error("Network forbidden in skill fixture");
	});
	const write = async (
		scope: "workspace" | "global",
		name: string,
		text: string,
	) => {
		const path =
			scope === "workspace"
				? join(repo.workspaceDir, ".mete", "skills", name, "SKILL.md")
				: join(repo.globalDir, "skills", name, "SKILL.md");
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text);
		return path;
	};
	const start = async (
		options: {
			workspaceDir?: string;
			without?: readonly string[];
			provider?: MeteModule;
		} = {},
	) => {
		const workspaceDir = options.workspaceDir ?? repo.workspaceDir;
		const made = await createApp({
			workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: options.provider ? [options.provider] : [],
			recover: false,
			fetch,
			without: [...OFFLINE, ...(options.without ?? [])],
			templatesDir: join(repo.globalDir, "no-templates"),
			adaptersDir: join(repo.globalDir, "no-adapters"),
		});
		if (!made.ok) throw new Error("Fixture app configuration failed");
		apps.add(made.value);
		return made.value;
	};
	return {
		repo,
		fetch,
		write,
		start,
		trust(app: App) {
			const resolved = app.registry.resolve<SkillTrustAdapter>("skill.trust@1");
			if (!resolved.ok) throw new Error("Native trust module missing");
			return resolved.value[0].impl;
		},
		async lock(workspaceDir = repo.workspaceDir) {
			const lock = await takeRunLock(runLockFile(workspaceDir));
			if (!lock.ok) throw new Error("Fixture lock failed");
			releases.add(lock.value);
			return async () => {
				releases.delete(lock.value);
				await lock.value();
			};
		},
		async stop(app: App) {
			apps.delete(app);
			await app.stop();
		},
		async close() {
			for (const app of apps) await app.stop();
			for (const release of releases) await release();
			await repo.close();
		},
	};
};
