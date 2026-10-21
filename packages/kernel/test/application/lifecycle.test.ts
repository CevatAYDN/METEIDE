import {
	type CapabilityRef,
	err,
	type MeteEvent,
	type ModuleManifest,
	ok,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createLifecycle } from "../../src/application/lifecycle.js";
import { createCapabilityRegistry } from "../../src/domain/capability-registry.js";
import { createEventBus } from "../../src/domain/event-bus.js";
import type { MeteModule, ModuleContext } from "../../src/domain/module.js";

const WORKSPACE = crypto.randomUUID();

const manifest = (
	id: string,
	provides: CapabilityRef[] = [],
	requires: CapabilityRef[] = [],
): ModuleManifest => ({
	id,
	version: "1.0.0",
	displayName: id,
	class: "optional",
	trust: "first-party",
	provides,
	requires,
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
});

// Provides its capabilities on activate, the way real modules do.
const fakeModule = (m: ModuleManifest, fails = false) => {
	const deactivate = vi.fn(async () => {});
	const mod: MeteModule = {
		manifest: m,
		activate: async (ctx) => {
			if (fails)
				return err({
					code: "activation_failed",
					moduleId: m.id,
					message: "no key",
				});
			for (const ref of m.provides)
				ctx.disposables.add(
					ctx.capabilities.provide(ref, {
						id: m.id,
						trust: m.trust,
						features: [],
						impl: {},
					}),
				);
			return ok(undefined);
		},
		deactivate,
	};
	return { mod, deactivate };
};

const setup = () => {
	const registry = createCapabilityRegistry(() => []);
	const events = createEventBus((e) => {
		throw e;
	});
	const seen: MeteEvent[] = [];
	events.subscribe("module.*", (e) => seen.push(e));
	const contextFor = (): ModuleContext => {
		const items: { dispose: () => void }[] = [];
		const log = () => {};
		return {
			capabilities: registry,
			events,
			config: { get: () => ok(undefined as never) },
			logger: { error: log, warn: log, info: log, debug: log },
			disposables: {
				add: (d) => items.push(d),
				dispose: () => {
					for (const d of items.splice(0)) d.dispose();
				},
			},
		};
	};
	const life = createLifecycle({
		registry,
		events,
		workspaceId: WORKSPACE,
		contextFor,
	});
	const log = () => seen.map((e) => `${e.type} ${JSON.stringify(e.payload)}`);
	return { life, registry, seen, log };
};

describe("createLifecycle", () => {
	it("activates a module without requires and publishes from the kernel", async () => {
		const { life, seen } = setup();
		await life.register(fakeModule(manifest("storage", ["storage.sql@1"])).mod);
		expect(life.state("storage")).toBe("active");
		expect(seen[0]).toMatchObject({
			type: "module.activated",
			source: "kernel",
			workspaceId: WORKSPACE,
			payload: { moduleId: "storage" },
		});
	});

	it("keeps a module resolving until its requires resolve, then activates it", async () => {
		const { life, log } = setup();
		const quota = manifest("quota", ["quota.reserve@1"], ["storage.sql@1"]);
		await life.register(fakeModule(quota).mod);
		expect(life.state("quota")).toBe("resolving");
		await life.register(fakeModule(manifest("storage", ["storage.sql@1"])).mod);
		expect(life.state("quota")).toBe("active");
		expect(log()).toEqual([
			'module.activated {"moduleId":"storage"}',
			'module.activated {"moduleId":"quota"}',
		]);
	});

	it("activates a chain registered in reverse order", async () => {
		const { life } = setup();
		await life.register(
			fakeModule(manifest("gateway", ["llm.chat@1"], ["quota.reserve@1"])).mod,
		);
		await life.register(
			fakeModule(manifest("quota", ["quota.reserve@1"], ["storage.sql@1"])).mod,
		);
		expect(life.state("gateway")).toBe("resolving");
		await life.register(fakeModule(manifest("storage", ["storage.sql@1"])).mod);
		expect(life.state("gateway")).toBe("active");
	});

	it("moves a module whose activate fails to inactive with the code as reason", async () => {
		const { life, registry, log } = setup();
		await life.register(
			fakeModule(manifest("provider-x", ["provider.chat@1"]), true).mod,
		);
		expect(life.state("provider-x")).toBe("inactive");
		expect(registry.has("provider.chat@1")).toBe(false);
		expect(log()).toEqual([
			'module.deactivated {"moduleId":"provider-x","reason":"activation_failed"}',
		]);
	});

	it("deactivates an active module and drops what it provided", async () => {
		const { life, registry, log } = setup();
		const { mod, deactivate } = fakeModule(
			manifest("storage", ["storage.sql@1"]),
		);
		await life.register(mod);
		await life.deactivate("storage");
		expect(deactivate).toHaveBeenCalledOnce();
		expect(life.state("storage")).toBe("inactive");
		expect(registry.has("storage.sql@1")).toBe(false);
		expect(log().at(-1)).toBe('module.deactivated {"moduleId":"storage"}');
	});

	it("ignores deactivate for a module that is not active", async () => {
		const { life, seen } = setup();
		await life.register(
			fakeModule(manifest("quota", [], ["storage.sql@1"])).mod,
		);
		await life.deactivate("quota");
		await life.deactivate("unknown");
		expect(life.state("quota")).toBe("resolving");
		expect(seen).toEqual([]);
	});

	it("activates once when registrations overlap", async () => {
		const { life, log } = setup();
		await Promise.all([
			life.register(fakeModule(manifest("quota", [], ["storage.sql@1"])).mod),
			life.register(fakeModule(manifest("storage", ["storage.sql@1"])).mod),
		]);
		expect(log()).toEqual([
			'module.activated {"moduleId":"storage"}',
			'module.activated {"moduleId":"quota"}',
		]);
	});

	it("throws when a module id is registered twice", async () => {
		const { life } = setup();
		await life.register(fakeModule(manifest("storage")).mod);
		await expect(
			life.register(fakeModule(manifest("storage")).mod),
		).rejects.toThrow(/storage/);
	});
});
