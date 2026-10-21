import type { ModuleManifest } from "@mete/contracts";
import type { CapabilityRegistry } from "../domain/capability-registry.js";
import type { EventBus } from "../domain/event-bus.js";
import type {
	MeteModule,
	ModuleContext,
	ModuleState,
} from "../domain/module.js";

// Module lifecycle from docs/06-kernel-and-modules.md (Module lifecycle).
// shortcut: every module activates as soon as its requires resolve; activation events
// (onWorkspaceOpen, onCapability, onCommand) arrive in the next kernel slice.

/** What the lifecycle needs from the composition root. */
export type LifecycleOptions = {
	readonly registry: CapabilityRegistry;
	readonly events: EventBus;
	readonly workspaceId: string;
	readonly contextFor: (manifest: ModuleManifest) => ModuleContext;
};

/** Registers, activates and deactivates modules. */
export type Lifecycle = {
	readonly register: (module: MeteModule) => Promise<void>;
	readonly deactivate: (moduleId: string) => Promise<void>;
	readonly state: (moduleId: string) => ModuleState | undefined;
};

type Entry = {
	readonly module: MeteModule;
	state: ModuleState;
	ctx?: ModuleContext;
};

/** Creates an empty lifecycle; calls run one at a time in call order. */
export const createLifecycle = (opts: LifecycleOptions): Lifecycle => {
	const entries = new Map<string, Entry>();
	let queue: Promise<unknown> = Promise.resolve();
	// Serializes calls so two registrations never activate the same module twice.
	const serial = <T>(task: () => Promise<T>): Promise<T> => {
		const next = queue.then(task);
		queue = next.catch(() => undefined); // the caller still gets the rejection
		return next;
	};

	const publish = (
		type: "module.activated" | "module.deactivated",
		moduleId: string,
		reason?: string,
	) =>
		opts.events.publish({
			id: crypto.randomUUID(),
			ts: new Date().toISOString(),
			schema: 1,
			workspaceId: opts.workspaceId,
			source: "kernel",
			type,
			payload: reason === undefined ? { moduleId } : { moduleId, reason },
		});

	const activate = async (entry: Entry) => {
		const { id } = entry.module.manifest;
		const ctx = opts.contextFor(entry.module.manifest);
		entry.ctx = ctx;
		const result = await entry.module.activate(ctx);
		if (result.ok) {
			entry.state = "active";
			publish("module.activated", id);
			return;
		}
		ctx.disposables.dispose();
		entry.state = "inactive";
		publish("module.deactivated", id, result.error.code);
	};

	// Re-checks every resolving module after each activation, until none can start.
	const settle = async () => {
		const ready = () =>
			[...entries.values()].find(
				(e) =>
					e.state === "resolving" &&
					e.module.manifest.requires.every((r) => opts.registry.has(r)),
			);
		for (let e = ready(); e; e = ready()) await activate(e);
	};

	return {
		register: (module) =>
			serial(async () => {
				const { id } = module.manifest;
				if (entries.has(id))
					throw new Error(`module ${id} is already registered`);
				const entry: Entry = { module, state: "registered" };
				entries.set(id, entry);
				// Nothing waits between the two yet; activation events will gate this step.
				entry.state = "resolving";
				await settle();
			}),
		deactivate: (moduleId) =>
			serial(async () => {
				const entry = entries.get(moduleId);
				if (entry?.state !== "active") return;
				entry.state = "deactivating";
				await entry.module.deactivate();
				entry.ctx?.disposables.dispose();
				entry.state = "inactive";
				publish("module.deactivated", moduleId);
			}),
		state: (moduleId) => entries.get(moduleId)?.state,
	};
};
