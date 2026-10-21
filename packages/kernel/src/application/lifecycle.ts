import type { ActivationEvent, ModuleManifest } from "@mete/contracts";
import type { CapabilityRegistry } from "../domain/capability-registry.js";
import type { EventBus } from "../domain/event-bus.js";
import type {
	MeteModule,
	ModuleContext,
	ModuleState,
} from "../domain/module.js";

// Module lifecycle from docs/06-kernel-and-modules.md (Module lifecycle).
// shortcut: onCommand never fires; wire it to the command system when apps/cli adds one.

/** What the lifecycle needs from the composition root. */
export type LifecycleOptions = {
	readonly registry: CapabilityRegistry;
	readonly events: EventBus;
	readonly workspaceId: string;
	readonly contextFor: (manifest: ModuleManifest) => ModuleContext;
};

/** Registers, activates and deactivates modules. */
export type Lifecycle = {
	readonly start: () => Promise<void>;
	readonly openWorkspace: () => Promise<void>;
	readonly register: (module: MeteModule) => Promise<void>;
	readonly deactivate: (moduleId: string) => Promise<void>;
	readonly state: (moduleId: string) => ModuleState | undefined;
};

type Entry = {
	readonly module: MeteModule;
	state: ModuleState;
	ctx?: ModuleContext;
};
type Entries = ReadonlyMap<string, Entry>;
type Fired = { startup: boolean; workspace: boolean };

const CAPABILITY = "onCapability:";

// Demand comes only from triggered modules, so an untriggered one never pulls in providers.
const demanded = (entries: Entries, ref: string) =>
	[...entries.values()].some(
		(e) =>
			e.state === "resolving" &&
			e.module.manifest.requires.some((r) => r === ref),
	);

const fires = (entries: Entries, fired: Fired, a: ActivationEvent) =>
	(a === "onStartup" && fired.startup) ||
	(a === "onWorkspaceOpen" && fired.workspace) ||
	(a.startsWith(CAPABILITY) && demanded(entries, a.slice(CAPABILITY.length)));

// Repeats because one promoted module may create demand for another.
const promote = (entries: Entries, fired: Fired) => {
	for (let changed = true; changed; ) {
		changed = false;
		for (const e of entries.values()) {
			if (e.state !== "registered") continue;
			if (!e.module.manifest.activation.some((a) => fires(entries, fired, a)))
				continue;
			e.state = "resolving";
			changed = true;
		}
	}
};

const nextReady = (entries: Entries, registry: CapabilityRegistry) =>
	[...entries.values()].find(
		(e) =>
			e.state === "resolving" &&
			e.module.manifest.requires.every((r) => registry.has(r)),
	);

const publish = (
	opts: LifecycleOptions,
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

const activate = async (opts: LifecycleOptions, entry: Entry) => {
	const { id } = entry.module.manifest;
	const ctx = opts.contextFor(entry.module.manifest);
	entry.ctx = ctx;
	const result = await entry.module.activate(ctx);
	if (result.ok) {
		entry.state = "active";
		publish(opts, "module.activated", id);
		return;
	}
	ctx.disposables.dispose();
	entry.state = "inactive";
	publish(opts, "module.deactivated", id, result.error.code);
};

const deactivate = async (opts: LifecycleOptions, entry: Entry) => {
	entry.state = "deactivating";
	await entry.module.deactivate();
	entry.ctx?.disposables.dispose();
	entry.state = "inactive";
	publish(opts, "module.deactivated", entry.module.manifest.id);
};

// Serializes calls so two registrations never activate the same module twice.
const createSerial = () => {
	let queue: Promise<unknown> = Promise.resolve();
	return <T>(task: () => Promise<T>): Promise<T> => {
		const next = queue.then(task);
		queue = next.catch(() => undefined); // the caller still gets the rejection
		return next;
	};
};

/** Creates an empty lifecycle; calls run one at a time in call order. */
export const createLifecycle = (opts: LifecycleOptions): Lifecycle => {
	const entries = new Map<string, Entry>();
	const fired: Fired = { startup: false, workspace: false };
	const serial = createSerial();
	// Re-checks every waiting module after each activation, until none can start.
	const settle = async () => {
		promote(entries, fired);
		for (let e = nextReady(entries, opts.registry); e; ) {
			await activate(opts, e);
			promote(entries, fired);
			e = nextReady(entries, opts.registry);
		}
	};
	const fire = (event: keyof Fired) =>
		serial(async () => {
			fired[event] = true;
			await settle();
		});
	return {
		start: () => fire("startup"),
		openWorkspace: () => fire("workspace"),
		register: (module) =>
			serial(async () => {
				const { id } = module.manifest;
				if (entries.has(id))
					throw new Error(`module ${id} is already registered`);
				entries.set(id, { module, state: "registered" });
				await settle();
			}),
		deactivate: (moduleId) =>
			serial(async () => {
				const entry = entries.get(moduleId);
				if (entry?.state === "active") await deactivate(opts, entry);
			}),
		state: (moduleId) => entries.get(moduleId)?.state,
	};
};
