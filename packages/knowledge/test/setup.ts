import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type CapabilityRef,
	type EventsReadAdapter,
	err,
	type MeteEvent,
	ok,
	type StorageSqlAdapter,
	type ToolContext,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll } from "vitest";
import { createVaultModule } from "../src/module.js";

// The vault module over fakes: events.read@1 answers every event published, the module's own
// included, as storage persists each event when it is published; fs.read@1 and fs.write@1 read and
// write under the context's cwd or else the workspace, as tools-fs does, and the write can be made
// to ask, as a policy at autonomy level 1 does. Real storage holds the access counts (ADR-173).

const roots: string[] = [];
const stores: { deactivate: () => Promise<void> }[] = [];
afterAll(async () => {
	await Promise.all(stores.map((s) => s.deactivate()));
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

// The vault's scoped storage, from a storage module on its own registry, so its events.read@1
// does not stand in for the fake one.
const storageFor = async (root: string, ctx: ModuleContext) => {
	const storage = createStorageModule({
		workspaceDir: join(root, "db"),
		globalDir: join(root, "global"),
	});
	stores.push(storage);
	const own = createCapabilityRegistry(() => []);
	await storage.activate({ ...ctx, capabilities: own });
	const sql = own.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 missing");
	return sql.value[0].impl.scopeFor("vault");
};

export const WS = "11111111-1111-4111-8111-111111111111";
export const NOW = Date.parse("2026-10-28T12:00:00.000Z");

type Path = { readonly path: string };

const fakeFs = (root: string, policy: { ask: boolean }) => ({
	read: {
		run: async ({ path }: Path, ctx: ToolContext) => {
			try {
				const content = await readFile(join(ctx.cwd ?? root, path), "utf8");
				return ok({ content, totalLines: 1, lineEnding: "lf" });
			} catch {
				return err({ code: "not_found", message: `${path} is missing` });
			}
		},
	},
	write: {
		run: async (
			{ path, content }: Path & { readonly content: string },
			ctx: ToolContext,
		) => {
			if (policy.ask)
				return err({
					code: "approval_required",
					rule: "autonomy:1",
					message: "ask",
				});
			const file = join(ctx.cwd ?? root, path);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, content, "utf8");
			return ok({ bytes: content.length });
		},
	},
});

const contextOf = (root: string, read?: EventsReadAdapter["read"]) => {
	const registry = createCapabilityRegistry(() => []);
	const bus = createEventBus((e) => {
		throw e;
	});
	const stored: MeteEvent[] = [];
	const impl: EventsReadAdapter = {
		read:
			read ??
			((id) => ({ events: stored.filter((e) => e.runId === id), broken: [] })),
	};
	const policy = { ask: false };
	const fs = fakeFs(root, policy);
	const provide = (ref: CapabilityRef, a: unknown) =>
		registry.provide(ref, { id: "fake", trust: "core", features: [], impl: a });
	provide("events.read@1", impl);
	provide("fs.read@1", fs.read);
	provide("fs.write@1", fs.write);
	return { registry, bus, stored, policy };
};

export const setup = async (read?: EventsReadAdapter["read"]) => {
	const root = await mkdtemp(join(tmpdir(), "mete-vault-"));
	roots.push(root);
	const { registry, bus, stored, policy } = contextOf(root, read);
	const errors: string[] = [];
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: bus,
		config: { get: () => ok(undefined as never) },
		logger: {
			error: (_o, m) => errors.push(String(m)),
			warn: log,
			info: log,
			debug: log,
		},
		disposables: { add: () => {}, dispose: () => {} },
	};
	const saved: MeteEvent[] = [];
	bus.subscribe("vault.*", (e) => {
		stored.push(e);
		saved.push(e);
	});
	const publish = (e: MeteEvent) => {
		stored.push(e);
		bus.publish(e);
	};
	const mod = createVaultModule({
		workspaceDir: root,
		workspaceId: WS,
		now: () => NOW,
	});
	const storage = await storageFor(root, ctx);
	await mod.activate({ ...ctx, storage });
	const file = (path: string) => readFile(join(root, path), "utf8");
	const note = (day: string) => file(`.mete/knowledge/journal/${day}.md`);
	const db = storage.workspace;
	return {
		root,
		mod,
		registry,
		publish,
		saved,
		errors,
		note,
		file,
		policy,
		db,
	};
};

/** The local date of a moment, as a journal note's name. */
export const day = (ts: string | number) => {
	const d = new Date(ts);
	const two = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
