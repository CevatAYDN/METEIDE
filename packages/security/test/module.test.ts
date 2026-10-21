import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PolicyCheckAdapter,
	PolicyCheckInput,
	SecretsMaskAdapter,
	StorageSqlAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll, describe, expect, it } from "vitest";
import { createSecurityModule } from "../src/module.js";

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const setup = async (policy: unknown = {}) => {
	const root = await mkdtemp(join(tmpdir(), "mete-security-"));
	roots.push(root);
	const dirs = {
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "global"),
	};
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const base = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: { file: join(dirs.globalDir, "settings.yaml"), sections: {} },
			workspace: {
				policy: {
					file: join(dirs.workspaceDir, ".mete", "policy.yaml"),
					value: policy,
				},
			},
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
	} satisfies ModuleContext;
	const storage = createStorageModule(dirs);
	await storage.activate(base);
	const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 missing");
	const scoped = sql.value[0].impl.scopeFor("security");
	const ctx: ModuleContext = { ...base, storage: scoped };
	const security = createSecurityModule({
		...dirs,
		home: join(root, "home"),
		now: () => 0,
	});
	const impl = <C>(ref: "policy.check@1" | "secrets.mask@1") => {
		const r = registry.resolve<C>(ref);
		if (!r.ok) throw new Error(`${ref} missing`);
		return r.value[0].impl;
	};
	return { dirs, registry, scoped, ctx, security, storage, impl };
};

const write = (path: string, args: unknown = { path }): PolicyCheckInput => ({
	action: "fs.write",
	capability: "fs.write@1",
	adapterId: "tools-fs",
	args,
	path,
});

describe("security module", () => {
	it("decides and writes one audit row per check", async () => {
		const s = await setup();
		expect(await s.security.activate(s.ctx)).toEqual({
			ok: true,
			value: undefined,
		});
		const policy = s.impl<PolicyCheckAdapter>("policy.check@1");
		const inside = join(s.dirs.workspaceDir, "src", "a.ts");
		expect(policy.check(write(inside))).toEqual({
			ok: true,
			value: { verdict: "allow", rule: "autonomy:2:inside" },
		});
		const rows = s.scoped.workspace
			.prepare(
				"SELECT ts, action, adapter_id, verdict, rule, tainted, length(args_sha256) AS h FROM audit_log",
			)
			.all();
		expect(rows).toEqual([
			{
				ts: "1970-01-01T00:00:00.000Z",
				action: "fs.write",
				adapter_id: "tools-fs",
				verdict: "allow",
				rule: "autonomy:2:inside",
				tainted: 0,
				h: 64,
			},
		]);
		await s.security.deactivate();
		expect(s.registry.has("policy.check@1")).toBe(false);
		await s.storage.deactivate();
	});

	it("uses the workspace policy file", async () => {
		const s = await setup({ autonomy: 1 });
		await s.security.activate(s.ctx);
		const r = s
			.impl<PolicyCheckAdapter>("policy.check@1")
			.check(write(join(s.dirs.workspaceDir, "a.ts")));
		expect(r.ok && r.value).toEqual({ verdict: "ask", rule: "autonomy:1" });
		await s.storage.deactivate();
	});

	it("returns audit_failed when the row cannot be written", async () => {
		const s = await setup();
		await s.security.activate(s.ctx);
		s.scoped.workspace.exec("DROP TABLE audit_log");
		const r = s
			.impl<PolicyCheckAdapter>("policy.check@1")
			.check(write(join(s.dirs.workspaceDir, "a.ts")));
		expect(r.ok ? undefined : r.error.code).toBe("audit_failed");
		await s.storage.deactivate();
	});

	it("hashes arguments JSON cannot represent and rejects malformed input", async () => {
		const s = await setup();
		await s.security.activate(s.ctx);
		const policy = s.impl<PolicyCheckAdapter>("policy.check@1");
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		expect(
			policy.check(write(join(s.dirs.workspaceDir, "a.ts"), cyclic)).ok,
		).toBe(true);
		expect(() =>
			policy.check({ ...write("/x"), capability: "not-a-ref" as "fs.write@1" }),
		).toThrow();
		await s.storage.deactivate();
	});

	it("masks secrets through secrets.mask@1", async () => {
		const s = await setup();
		await s.security.activate(s.ctx);
		const token = `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;
		const r = await s
			.impl<SecretsMaskAdapter>("secrets.mask@1")
			.mask(`key ${token}`);
		expect(r.masked).toBe(1);
		expect(r.text).not.toContain(token);
		await s.storage.deactivate();
	});

	it("refuses to start on an invalid policy or without storage", async () => {
		const bad = await setup({ autonomy: 7 });
		const r = await bad.security.activate(bad.ctx);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "activation_failed",
			moduleId: "security",
		});
		expect(r.ok ? "" : r.error.message).toContain("policy.yaml autonomy");
		const { storage: _omit, ...noStorage } = bad.ctx;
		const r2 = await bad.security.activate(noStorage);
		expect(r2.ok ? "" : r2.error.message).toMatch(/storage\.sql@1/);
		await bad.storage.deactivate();
	});
});
