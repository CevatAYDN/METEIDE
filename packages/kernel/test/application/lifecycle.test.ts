import {
	type CapabilityRef,
	err,
	type MeteEvent,
	type ModuleManifest,
	ok,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createLifecycle } from "../../src/application/lifecycle.js";
import {
	SUPERVISOR_MAX_RESTARTS,
	SUPERVISOR_WINDOW_MS,
} from "../../src/defaults.js";
import { createCapabilityRegistry } from "../../src/domain/capability-registry.js";
import { createEventBus } from "../../src/domain/event-bus.js";
import type { MeteModule, ModuleContext } from "../../src/domain/module.js";

const WORKSPACE = crypto.randomUUID();

const manifest = (
	id: string,
	provides: CapabilityRef[] = [],
	requires: CapabilityRef[] = [],
	activation: ModuleManifest["activation"] = ["onStartup"],
): ModuleManifest => ({
	id,
	version: "1.0.0",
	displayName: id,
	class: "optional",
	trust: "first-party",
	provides,
	requires,
	optional: [],
	activation,
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

const setup = async (start = true) => {
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
	let t = 0;
	const errors = vi.fn();
	const noop = () => {};
	const life = createLifecycle({
		registry,
		events,
		workspaceId: WORKSPACE,
		contextFor,
		logger: { error: errors, warn: noop, info: noop, debug: noop },
		now: () => t,
	});
	const log = () => seen.map((e) => `${e.type} ${JSON.stringify(e.payload)}`);
	if (start) await life.start();
	const advance = (ms: number) => (t += ms);
	return { life, registry, seen, log, errors, advance };
};

// Throws from activate the first `times` calls, or from deactivate when asked.
const crashingModule = (
	m: ModuleManifest,
	opts: { activateThrows?: number; deactivateThrows?: boolean },
) => {
	let calls = 0;
	const deactivate = vi.fn(async () => {
		if (opts.deactivateThrows) throw new RangeError("bad state");
	});
	const mod: MeteModule = {
		manifest: m,
		activate: async () => {
			calls += 1;
			if (calls <= (opts.activateThrows ?? 0)) throw new TypeError("boom");
			return ok(undefined);
		},
		deactivate,
	};
	return { mod, deactivate };
};

describe("supervisor", () => {
	it("restarts a module that crashes while active", async () => {
		const { life, log, errors } = await setup();
		const { mod, deactivate } = fakeModule(manifest("vault"));
		await life.register(mod);
		await life.crash("vault", new TypeError("handler failed"));
		expect(deactivate).toHaveBeenCalledOnce();
		expect(errors).toHaveBeenCalledOnce();
		expect(life.state("vault")).toBe("active");
		expect(log()).toEqual([
			'module.activated {"moduleId":"vault"}',
			'module.crashed {"moduleId":"vault","reason":"TypeError"}',
			'module.activated {"moduleId":"vault"}',
		]);
	});

	it("disables a module after the maximum restarts in the window", async () => {
		const { life, log } = await setup();
		await life.register(
			crashingModule(manifest("broken"), { activateThrows: 99 }).mod,
		);
		expect(life.state("broken")).toBe("disabled");
		expect(log()).toEqual([
			...Array(SUPERVISOR_MAX_RESTARTS + 1).fill(
				'module.crashed {"moduleId":"broken","reason":"TypeError"}',
			),
			'module.disabled {"moduleId":"broken"}',
		]);
	});

	it("keeps restarting when crashes are spread past the window", async () => {
		const { life, advance } = await setup();
		await life.register(fakeModule(manifest("vault")).mod);
		for (let i = 0; i <= SUPERVISOR_MAX_RESTARTS; i++) {
			await life.crash("vault", new Error("again"));
			advance(SUPERVISOR_WINDOW_MS);
		}
		expect(life.state("vault")).toBe("active");
	});

	it("still deactivates a module whose deactivate throws", async () => {
		const { life, log } = await setup();
		const vault = crashingModule(manifest("vault"), { deactivateThrows: true });
		await life.register(vault.mod);
		await life.deactivate("vault");
		expect(life.state("vault")).toBe("inactive");
		expect(log().slice(1)).toEqual([
			'module.crashed {"moduleId":"vault","reason":"RangeError"}',
			'module.deactivated {"moduleId":"vault"}',
		]);
	});

	it("restarts even when cleanup throws, and names a non-Error by its type", async () => {
		const { life, log, errors } = await setup();
		const vault = crashingModule(manifest("vault"), { deactivateThrows: true });
		await life.register(vault.mod);
		await life.crash("vault", "plain string");
		expect(errors).toHaveBeenCalledTimes(2);
		expect(life.state("vault")).toBe("active");
		expect(log()[1]).toBe(
			'module.crashed {"moduleId":"vault","reason":"string"}',
		);
	});

	it("ignores a crash report for a module that is not active", async () => {
		const { life, seen } = await setup();
		await life.crash("unknown", new Error("late"));
		expect(seen).toEqual([]);
	});
});

describe("activation events", () => {
	it("keeps an onStartup module registered until the kernel starts", async () => {
		const { life } = await setup(false);
		await life.register(fakeModule(manifest("storage")).mod);
		expect(life.state("storage")).toBe("registered");
		await life.start();
		expect(life.state("storage")).toBe("active");
	});

	it("activates an onWorkspaceOpen module when the workspace opens", async () => {
		const { life } = await setup();
		await life.register(
			fakeModule(manifest("vault", [], [], ["onWorkspaceOpen"])).mod,
		);
		expect(life.state("vault")).toBe("registered");
		await life.openWorkspace();
		expect(life.state("vault")).toBe("active");
	});

	it("activates an onCapability provider when a resolving module requires it", async () => {
		const { life, log } = await setup();
		const storage = manifest(
			"storage",
			["storage.sql@1"],
			[],
			["onCapability:storage.sql@1"],
		);
		await life.register(fakeModule(storage).mod);
		expect(life.state("storage")).toBe("registered");
		await life.register(
			fakeModule(manifest("quota", [], ["storage.sql@1"])).mod,
		);
		expect(log()).toEqual([
			'module.activated {"moduleId":"storage"}',
			'module.activated {"moduleId":"quota"}',
		]);
	});

	it("ignores demand from a module that was not triggered", async () => {
		const { life } = await setup();
		const storage = manifest(
			"storage",
			["storage.sql@1"],
			[],
			["onCapability:storage.sql@1"],
		);
		await life.register(fakeModule(storage).mod);
		await life.register(
			fakeModule(
				manifest("export", [], ["storage.sql@1"], ["onCommand:export"]),
			).mod,
		);
		expect(life.state("storage")).toBe("registered");
		expect(life.state("export")).toBe("registered");
	});

	it("keeps dependents active when their provider deactivates", async () => {
		const { life } = await setup();
		await life.register(fakeModule(manifest("storage", ["storage.sql@1"])).mod);
		await life.register(
			fakeModule(manifest("quota", [], ["storage.sql@1"])).mod,
		);
		await life.deactivate("storage");
		expect(life.state("quota")).toBe("active");
	});
});

describe("createLifecycle", () => {
	it("activates a module without requires and publishes from the kernel", async () => {
		const { life, seen } = await setup();
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
		const { life, log } = await setup();
		const quota = manifest("quota", ["quota.reserve@3"], ["storage.sql@1"]);
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
		const { life } = await setup();
		await life.register(
			fakeModule(manifest("gateway", ["llm.chat@2"], ["quota.reserve@3"])).mod,
		);
		await life.register(
			fakeModule(manifest("quota", ["quota.reserve@3"], ["storage.sql@1"])).mod,
		);
		expect(life.state("gateway")).toBe("resolving");
		await life.register(fakeModule(manifest("storage", ["storage.sql@1"])).mod);
		expect(life.state("gateway")).toBe("active");
	});

	it("moves a module whose activate fails to inactive with the code as reason", async () => {
		const { life, registry, log } = await setup();
		await life.register(
			fakeModule(manifest("provider-x", ["provider.chat@2"]), true).mod,
		);
		expect(life.state("provider-x")).toBe("inactive");
		expect(registry.has("provider.chat@2")).toBe(false);
		expect(log()).toEqual([
			'module.deactivated {"moduleId":"provider-x","reason":"activation_failed"}',
		]);
	});

	it("deactivates an active module and drops what it provided", async () => {
		const { life, registry, log } = await setup();
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

	it("stops active modules last activated first and activates nothing after", async () => {
		const { life, log } = await setup();
		const storage = fakeModule(manifest("storage", ["storage.sql@1"]));
		const quota = fakeModule(
			manifest("quota", ["quota.reserve@3"], ["storage.sql@1"]),
		);
		const late = fakeModule(manifest("late", [], [], ["onWorkspaceOpen"]));
		await life.register(quota.mod);
		await life.register(storage.mod);
		await life.register(late.mod);
		await life.stop();
		expect(log().slice(-2)).toEqual([
			'module.deactivated {"moduleId":"quota"}',
			'module.deactivated {"moduleId":"storage"}',
		]);
		await life.openWorkspace();
		expect(life.state("late")).toBe("registered");
		expect(life.state("storage")).toBe("inactive");
	});

	it("ignores deactivate for a module that is not active", async () => {
		const { life, seen } = await setup();
		await life.register(
			fakeModule(manifest("quota", [], ["storage.sql@1"])).mod,
		);
		await life.deactivate("quota");
		await life.deactivate("unknown");
		expect(life.state("quota")).toBe("resolving");
		expect(seen).toEqual([]);
	});

	it("activates once when registrations overlap", async () => {
		const { life, log } = await setup();
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
		const { life } = await setup();
		await life.register(fakeModule(manifest("storage")).mod);
		await expect(
			life.register(fakeModule(manifest("storage")).mod),
		).rejects.toThrow(/storage/);
	});
});
