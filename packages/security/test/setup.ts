import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageSqlAdapter } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll } from "vitest";
import { createSecurityModule } from "../src/module.js";

// Real storage and SQLite in a temp folder, as docs/15 asks of integration tests.
const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

/** A security module over real storage; `policy` is the workspace policy.yaml content. */
export const setup = async (policy: unknown = {}) => {
	const root = await mkdtemp(join(tmpdir(), "mete-security-"));
	roots.push(root);
	const dirs = {
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "global"),
	};
	const home = join(root, "home");
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
	const workspaceId = crypto.randomUUID();
	const security = createSecurityModule({
		...dirs,
		home,
		workspaceId,
		now: () => 0,
	});
	const impl = <C>(
		ref: "policy.check@1" | "policy.grant@1" | "secrets.mask@1",
	) => {
		const r = registry.resolve<C>(ref);
		if (!r.ok) throw new Error(`${ref} missing`);
		return r.value[0].impl;
	};
	return {
		dirs,
		home,
		workspaceId,
		registry,
		scoped,
		ctx,
		security,
		storage,
		impl,
	};
};
