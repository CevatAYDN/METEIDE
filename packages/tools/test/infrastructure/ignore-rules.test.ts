import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadIgnore } from "../../src/infrastructure/ignore-rules.js";
import { tempWorkspace } from "./workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(() => ws.close());

const load = async () => {
	const r = await loadIgnore(ws.workspaceDir, join(ws.globalDir, "worktrees"));
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
};

describe("loadIgnore", () => {
	it("applies the defaults without a .meteignore, also below a folder rule", async () => {
		ws = await tempWorkspace();
		const ignored = await load();
		const at = (rel: string) => join(ws.workspaceDir, rel);
		expect(ignored(at(".env"))).toBe(true);
		expect(ignored(at("deep/x.pem"))).toBe(true);
		expect(ignored(at("secrets/k.txt"))).toBe(true);
		expect(ignored(at("secrets"), true)).toBe(true);
		expect(ignored(at("secrets"))).toBe(false);
		expect(ignored(at("src/a.ts"))).toBe(false);
		expect(ignored(ws.workspaceDir)).toBe(false);
	});

	it("adds the workspace's lines and lets them re-include a default", async () => {
		ws = await tempWorkspace();
		await ws.put(".meteignore", "build/\n!.env.example\n");
		const ignored = await load();
		expect(ignored(join(ws.workspaceDir, "build/o.js"))).toBe(true);
		expect(ignored(join(ws.workspaceDir, ".env.example"))).toBe(false);
		expect(ignored(join(ws.workspaceDir, ".env"))).toBe(true);
	});

	it("checks worktree paths and leaves other paths alone", async () => {
		ws = await tempWorkspace();
		const ignored = await load();
		expect(ignored(join(ws.globalDir, "worktrees", "w1", ".env"))).toBe(true);
		expect(ignored(join(ws.globalDir, "other", ".env"))).toBe(false);
	});
});
