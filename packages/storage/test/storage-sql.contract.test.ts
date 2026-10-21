import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type StorageSqlAdapter } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { storageSqlContract } from "@mete/testing";
import { createStorageModule } from "../src/module.js";

// Runs the storage.sql@1 contract kit against this package's adapter.
storageSqlContract("storage module", async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-contract-"));
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: { get: () => ok(undefined as never) },
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
	};
	const mod = createStorageModule({
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "global"),
	});
	await mod.activate(ctx);
	const chain = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!chain.ok) throw new Error("storage.sql@1 was not provided");
	return {
		adapter: chain.value[0].impl,
		close: async () => {
			await mod.deactivate();
			await rm(root, { recursive: true, force: true });
		},
	};
});
