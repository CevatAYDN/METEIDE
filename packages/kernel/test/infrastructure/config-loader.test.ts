import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { mergedSection } from "../../src/domain/config-reader.js";
import { loadConfig } from "../../src/infrastructure/config-loader.js";

const ID = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const dirs = async (files: Record<string, string> = {}) => {
	const root = await mkdtemp(join(tmpdir(), "mete-config-"));
	roots.push(root);
	const globalDir = join(root, "global");
	const workspaceDir = join(root, "repo");
	await mkdir(globalDir, { recursive: true });
	await mkdir(join(workspaceDir, ".mete"), { recursive: true });
	for (const [name, text] of Object.entries(files))
		await writeFile(join(root, name), text);
	return { globalDir, workspaceDir };
};

describe("loadConfig", () => {
	it("creates workspace.yaml with a new id once and reuses it", async () => {
		const d = await dirs();
		const first = await loadConfig(d);
		const second = await loadConfig(d);
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(first.value.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
		expect(second.value.workspaceId).toBe(first.value.workspaceId);
		const text = await readFile(
			join(d.workspaceDir, ".mete", "workspace.yaml"),
			"utf8",
		);
		expect(text).toContain(first.value.workspaceId);
	});

	it("merges global settings with workspace files and reads bindings", async () => {
		const d = await dirs({
			"global/settings.yaml": "mcp:\n  timeoutSec: 10\n  retries: 2\n",
			"repo/.mete/workspace.yaml": `id: ${ID}\n`,
			"repo/.mete/mcp.yaml": "retries: 5\n",
			"repo/.mete/bindings.yaml": "web.search@1: [exa-mcp, tavily]\n",
		});
		const r = await loadConfig(d);
		if (!r.ok) throw new Error(JSON.stringify(r.error));
		expect(r.value.workspaceId).toBe(ID);
		const mcp = r.value.reader.get(
			"mcp",
			z.object({ timeoutSec: z.number(), retries: z.number() }),
		);
		expect(mcp).toEqual({ ok: true, value: { timeoutSec: 10, retries: 5 } });
		expect(r.value.bindings("web.search@1")).toEqual(["exa-mcp", "tavily"]);
		expect(r.value.bindings("fs.read@1")).toEqual([]);
		// The files as read, for the read-only Settings screen (ADR-081).
		expect(r.value.layers.global.sections).toEqual({
			mcp: { timeoutSec: 10, retries: 2 },
		});
		expect(r.value.layers.global.file).toMatch(/settings\.yaml$/);
		expect(r.value.layers.workspace.mcp?.value).toEqual({ retries: 5 });
		expect(r.value.layers.workspace.mcp?.file).toMatch(/mcp\.yaml$/);
		expect(mergedSection(r.value.layers, "mcp")).toEqual({
			timeoutSec: 10,
			retries: 5,
		});
	});

	it("uses a built-in binding until the user binds that capability", async () => {
		const d = await dirs({
			"repo/.mete/workspace.yaml": `id: ${ID}\n`,
			"repo/.mete/bindings.yaml": "web.fetch@1: [mine]\n",
		});
		const r = await loadConfig(d, {
			"web.search@1": ["exa-mcp", "tavily"],
			"web.fetch@1": ["built-in"],
		});
		if (!r.ok) throw new Error(JSON.stringify(r.error));
		expect(r.value.bindings("web.search@1")).toEqual(["exa-mcp", "tavily"]);
		expect(r.value.bindings("web.fetch@1")).toEqual(["mine"]);
	});

	it("treats an empty file as no settings", async () => {
		const d = await dirs({
			"repo/.mete/workspace.yaml": `id: ${ID}\n`,
			"repo/.mete/bindings.yaml": "",
		});
		const r = await loadConfig(d);
		expect(r.ok).toBe(true);
	});

	it("rejects a YAML syntax error with its file", async () => {
		const d = await dirs({ "global/settings.yaml": "mcp: [unclosed\n" });
		const r = await loadConfig(d);
		expect(r.ok ? undefined : r.error[0]).toMatchObject({
			code: "config_invalid",
			file: join(d.globalDir, "settings.yaml"),
		});
	});

	it("collects every invalid kernel file", async () => {
		const d = await dirs({
			"repo/.mete/workspace.yaml": "id: 42\n",
			"repo/.mete/bindings.yaml": "web-search: [exa-mcp]\n",
		});
		const r = await loadConfig(d);
		const meta = join(d.workspaceDir, ".mete");
		expect(r.ok ? [] : r.error.map((e) => [e.file, e.path])).toEqual([
			[join(meta, "workspace.yaml"), "id"],
			[join(meta, "bindings.yaml"), "web-search"],
		]);
	});

	it("rejects a YAML syntax error in a workspace file", async () => {
		const d = await dirs({ "repo/.mete/mcp.yaml": "servers: {bad\n" });
		const r = await loadConfig(d);
		expect(r.ok ? undefined : r.error[0]?.file).toBe(
			join(d.workspaceDir, ".mete", "mcp.yaml"),
		);
	});

	it("reports an unreadable file instead of throwing", async () => {
		const d = await dirs();
		await mkdir(join(d.workspaceDir, ".mete", "mcp.yaml"));
		const r = await loadConfig(d);
		expect(r.ok ? undefined : r.error[0]).toMatchObject({
			file: join(d.workspaceDir, ".mete", "mcp.yaml"),
			reason: expect.stringMatching(/^EISDIR/),
		});
	});

	it("reports a workspace folder it cannot create", async () => {
		const d = await dirs({ "not-a-dir": "" });
		const r = await loadConfig({
			...d,
			workspaceDir: join(d.workspaceDir, "..", "not-a-dir"),
		});
		expect(r.ok ? undefined : r.error).toHaveLength(1);
	});

	it("writes .mete/.gitignore once and keeps a user's own", async () => {
		const d = await dirs();
		await loadConfig(d);
		const file = join(d.workspaceDir, ".mete", ".gitignore");
		expect(await readFile(file, "utf8")).toBe("mete.db*\ncache/\nworktrees/\n");
		await writeFile(file, "custom\n");
		await loadConfig(d);
		expect(await readFile(file, "utf8")).toBe("custom\n");
	});

	it("rejects a settings file that is not a mapping", async () => {
		const d = await dirs({ "global/settings.yaml": "- just\n- a list\n" });
		const r = await loadConfig(d);
		expect(r.ok ? undefined : r.error[0]?.reason).toMatch(/mapping/);
	});
});
