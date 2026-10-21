import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { VcsGitAdapter } from "@mete/contracts";
import { vcsGitContract } from "@mete/testing";
import { beforeAll } from "vitest";
import { createVcsGitModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { initRepo, isolateGit } from "./helpers/repo.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

beforeAll(isolateGit);

vcsGitContract("vcs-git", async (verdict) => {
	const ws = await tempWorkspace();
	await initRepo(ws.workspaceDir);
	const { ctx, registry } = toolContext(verdict);
	const r = await createVcsGitModule(ws).activate(ctx);
	if (!r.ok) throw new Error(r.error.message);
	const c = registry.resolve<VcsGitAdapter>("vcs.git@1");
	if (!c.ok) throw new Error("vcs.git@1 missing");
	const at = (p: string) => join(ws.workspaceDir, p);
	return {
		adapter: c.value[0].impl,
		put: async (p, text) => void (await ws.put(p, text)),
		read: (p) => readFile(at(p), "utf8").catch(() => undefined),
		remove: (p) => rm(at(p)),
		close: ws.close,
	};
});
