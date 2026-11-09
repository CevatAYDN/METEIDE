import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listSkillSources } from "../../src/infrastructure/skill-enumeration.js";
import {
	skillLocation,
	skillRoot,
} from "../../src/infrastructure/skill-location.js";
import { tempWorkspace } from "./workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return {
		...native,
		lstat: vi.fn(native.lstat),
		realpath: vi.fn(native.realpath),
	};
});
const native =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
const signal = () => new AbortController().signal;
const root = (scope: "workspace" | "global" = "workspace") =>
	skillRoot(ws, scope, signal());
const put = () => ws.put(".mete/skills/one/SKILL.md", "body");
const locate = async () => {
	const current = await root();
	return current.ok ? skillLocation(current.value, "one", signal()) : current;
};
beforeEach(async () => {
	ws = await tempWorkspace();
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.mocked(fs.lstat).mockReset().mockImplementation(native.lstat);
	vi.mocked(fs.realpath).mockReset().mockImplementation(native.realpath);
	await ws.close();
});

it("keeps both missing roots absent", async () => {
	for (const scope of ["workspace", "global"] as const) {
		expect(await root(scope)).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
	}
	await expect(fs.stat(join(ws.globalDir, "skills"))).rejects.toThrow();
});

it("separates scopes and retains identity across byte changes", async () => {
	await put();
	await ws.put("skills/one/SKILL.md", "body", ws.globalDir);
	const first = await locate();
	await ws.put(".mete/skills/one/SKILL.md", "changed");
	const changed = await locate();
	expect(changed.ok && changed.value.source).toEqual(
		first.ok && first.value.source,
	);
	const global = await root("global");
	expect(first.ok).toBe(true);
	expect(global.ok).toBe(true);
	if (!first.ok || !global.ok) throw new Error("Expected both skill roots");
	const other = await skillLocation(global.value, "one", signal());
	expect(other.ok).toBe(true);
	if (!other.ok) throw new Error("Expected the global skill source");
	expect(first.value.source.sourceId).not.toBe(other.value.source.sourceId);
});

it("reloads ignore rules through a workspace alias", async () => {
	await put();
	const alias = join(ws.globalDir, "alias");
	await fs.symlink(ws.workspaceDir, alias, "junction");
	await ws.put(".meteignore", ".mete/skills/one/\n");
	const aliased = await skillRoot(
		{ ...ws, workspaceDir: alias },
		"workspace",
		signal(),
	);
	expect(
		aliased.ok && (await skillLocation(aliased.value, "one", signal())),
	).toMatchObject({ ok: false, error: { code: "ignored" } });
	await ws.put(".meteignore", "");
	expect(await locate()).toMatchObject({ ok: true });
});

it.each([".mete", ".mete/skills", "skills"])(
	"refuses a linked root chain: %s",
	async (path) => {
		const base = path === "skills" ? ws.globalDir : ws.workspaceDir;
		await fs.mkdir(join(base, path, ".."), { recursive: true });
		await fs.symlink(
			join(ws.globalDir, "worktrees"),
			join(base, path),
			"junction",
		);
		expect(await root(path === "skills" ? "global" : "workspace")).toEqual({
			ok: false,
			error: { code: "unavailable", location: "root" },
		});
	},
);

it("refuses hardlinks and unsafe directory labels before native resolution", async () => {
	const file = await put();
	await fs.link(file, join(ws.globalDir, "copy"));
	expect(await locate()).toMatchObject({
		ok: false,
		error: { code: "bad_input" },
	});
	const current = await root();
	for (const name of ["..", "../one", "one:stream", "nul"]) {
		expect(
			current.ok && (await skillLocation(current.value, name, signal())),
		).toEqual({
			ok: false,
			error: { code: "bad_input", location: "path" },
		});
	}
});

it.each(["hardlink", "directory", "linked child"])(
	"retains the known source identity after a %s mutation",
	async (mutation) => {
		const file = await put();
		const first = await locate();
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error("Expected the initial skill source");
		if (mutation === "hardlink") {
			await fs.link(file, join(ws.globalDir, "copy"));
		} else if (mutation === "directory") {
			await fs.unlink(file);
			await fs.mkdir(file);
		} else {
			const child = join(ws.workspaceDir, ".mete", "skills", "one");
			const target = join(ws.globalDir, "one");
			await fs.rename(child, target);
			await fs.symlink(target, child, "junction");
		}
		const error = {
			code: "bad_input",
			location: "source",
			sourceId: first.value.source.sourceId,
		};
		expect(await locate()).toEqual({ ok: false, error });
		expect(await listSkillSources(ws, signal())).toEqual({
			ok: true,
			value: { sources: [], diagnostics: [error], complete: true },
		});
	},
);

it.each([
	"missing",
	"unreadable",
	"canonical unreadable",
	"canonical mismatch",
])(
	"retains source identity and failure code for %s source resolution",
	async (failure) => {
		const file = await put();
		const first = await locate();
		const current = await root();
		if (!first.ok || !current.ok)
			throw new Error("Expected the initial skill source and root");
		if (failure === "missing") {
			await fs.unlink(file);
		} else if (failure === "unreadable") {
			const folder = await fs.lstat(
				join(ws.workspaceDir, ".mete", "skills", "one"),
				{ bigint: true },
			);
			vi.mocked(fs.lstat)
				.mockResolvedValueOnce(folder)
				.mockRejectedValueOnce(new Error(file));
		} else if (failure === "canonical unreadable") {
			vi.mocked(fs.realpath).mockRejectedValueOnce(new Error(file));
		} else {
			vi.mocked(fs.realpath).mockResolvedValueOnce(
				join(ws.workspaceDir, ".mete", "skills", "other", "SKILL.md"),
			);
		}
		expect(await skillLocation(current.value, "one", signal())).toEqual({
			ok: false,
			error: {
				code:
					failure === "missing"
						? "not_found"
						: failure === "canonical mismatch"
							? "bad_input"
							: "unavailable",
				location: failure === "canonical mismatch" ? "path" : "source",
				sourceId: first.value.source.sourceId,
			},
		});
	},
);

it("retains source identity when native source inspection is cancelled", async () => {
	await put();
	const first = await locate();
	const current = await root();
	if (!first.ok || !current.ok)
		throw new Error("Expected the initial skill source and root");
	const controller = new AbortController();
	controller.abort();
	expect(await skillLocation(current.value, "one", controller.signal)).toEqual({
		ok: false,
		error: {
			code: "aborted",
			location: "source",
			sourceId: first.value.source.sourceId,
		},
	});
});

it("changes identity when the root is replaced at the same path", async () => {
	await put();
	const first = await locate();
	await fs.rename(
		join(ws.workspaceDir, ".mete/skills"),
		join(ws.workspaceDir, ".mete/old"),
	);
	await put();
	const replacement = await locate();
	expect(replacement.ok && replacement.value.source.sourceId).not.toBe(
		first.ok && first.value.source.sourceId,
	);
});

it("sanitizes unreadable roots and returns cancellation as a Result", async () => {
	await put();
	vi.mocked(fs.lstat).mockRejectedValueOnce(new Error(ws.workspaceDir));
	expect(await root()).toEqual({
		ok: false,
		error: { code: "unavailable", location: "root" },
	});
	const controller = new AbortController();
	controller.abort();
	expect(await skillRoot(ws, "workspace", controller.signal)).toEqual({
		ok: false,
		error: { code: "aborted" },
	});
});
