import type { ActivationEvent, ModuleManifest } from "@mete/contracts";
import type { CapabilityRegistry } from "../domain/capability-registry.js";
import type { EventBus } from "../domain/event-bus.js";
import type {
	Logger,
	MeteModule,
	ModuleContext,
	ModuleState,
} from "../domain/module.js";
import {
	createRestartBudget,
	type RestartBudget,
} from "../domain/restart-budget.js";

// Module lifecycle from docs/06-kernel-and-modules.md (Module lifecycle).
// shortcut: onCommand never fires; wire it to the command system when apps/cli adds one.

/** What the lifecycle needs from the composition root. */
export type LifecycleOptions = {
	readonly registry: CapabilityRegistry;
	readonly events: EventBus;
	readonly workspaceId: string;
	readonly contextFor: (manifest: ModuleManifest) => ModuleContext;
	readonly logger: Logger;
	readonly now?: () => number;
};

/** Registers, activates and deactivates modules. */
export type Lifecycle = {
	readonly start: () => Promise<void>;
	readonly openWorkspace: () => Promise<void>;
	readonly register: (module: MeteModule) => Promise<void>;
	readonly deactivate: (moduleId: string) => Promise<void>;
	/** Deactivates every active module, last activated first; nothing activates after it. */
	readonly stop: () => Promise<void>;
	/** Reports a crash outside activate and deactivate, such as a throwing event handler. */
	readonly crash: (moduleId: string, error: unknown) => Promise<void>;
	readonly state: (moduleId: string) => ModuleState | undefined;
};

type Entry = {
	readonly module: MeteModule;
	readonly budget: RestartBudget;
	state: ModuleState;
	ctx?: ModuleContext;
	/** Activation count when it last became active, for the reverse order of stop(). */
	activatedAt?: number;
};

// Increases for every activation in the process, so later activations sort after earlier ones.
let activations = 0;
type Entries = ReadonlyMap<string, Entry>;
type Fired = { startup: boolean; workspace: boolean; stopped: boolean };

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
	type:
		| "module.activated"
		| "module.deactivated"
		| "module.crashed"
		| "module.disabled",
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

// Only the error name is published: events persist, and a message may hold secrets.
const reportCrash = (opts: LifecycleOptions, id: string, error: unknown) => {
	opts.logger.error({ module: id, err: error }, "module crashed");
	const name = error instanceof Error ? error.name : typeof error;
	publish(opts, "module.crashed", id, name);
};

// Calls deactivate as cleanup; a second exception there is logged, not raised.
const release = async (opts: LifecycleOptions, entry: Entry) => {
	try {
		await entry.module.deactivate();
	} catch (error) {
		opts.logger.error(
			{ module: entry.module.manifest.id, err: error },
			"deactivate failed",
		);
	}
	entry.ctx?.disposables.dispose();
};

// Restarts at once by returning to resolving, unless the restart budget is spent.
const onCrash = async (
	opts: LifecycleOptions,
	entry: Entry,
	error: unknown,
) => {
	const { id } = entry.module.manifest;
	reportCrash(opts, id, error);
	entry.state = "restarting";
	await release(opts, entry);
	if (entry.budget.take()) {
		entry.state = "resolving";
		return;
	}
	entry.state = "disabled";
	publish(opts, "module.disabled", id);
};

const activate = async (opts: LifecycleOptions, entry: Entry) => {
	const { id } = entry.module.manifest;
	const ctx = opts.contextFor(entry.module.manifest);
	entry.ctx = ctx;
	let result: Awaited<ReturnType<MeteModule["activate"]>>;
	try {
		result = await entry.module.activate(ctx);
	} catch (error) {
		await onCrash(opts, entry, error);
		return;
	}
	if (result.ok) {
		entry.state = "active";
		entry.activatedAt = ++activations;
		publish(opts, "module.activated", id);
		return;
	}
	ctx.disposables.dispose();
	entry.state = "inactive";
	publish(opts, "module.deactivated", id, result.error.code);
};

const deactivate = async (opts: LifecycleOptions, entry: Entry) => {
	entry.state = "deactivating";
	try {
		await entry.module.deactivate();
	} catch (error) {
		reportCrash(opts, entry.module.manifest.id, error);
	}
	entry.ctx?.disposables.dispose();
	entry.state = "inactive";
	publish(opts, "module.deactivated", entry.module.manifest.id);
};

// Re-checks every waiting module after each activation, until none can start.
const settleAll = async (
	opts: LifecycleOptions,
	entries: Entries,
	fired: Fired,
) => {
	if (fired.stopped) return;
	promote(entries, fired);
	for (let e = nextReady(entries, opts.registry); e; ) {
		await activate(opts, e);
		promote(entries, fired);
		e = nextReady(entries, opts.registry);
	}
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
	const fired: Fired = { startup: false, workspace: false, stopped: false };
	const serial = createSerial();
	const settle = () => settleAll(opts, entries, fired);
	const fire = (event: "startup" | "workspace") =>
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
				const budget = createRestartBudget(opts.now);
				entries.set(id, { module, budget, state: "registered" });
				await settle();
			}),
		deactivate: (moduleId) =>
			serial(async () => {
				const entry = entries.get(moduleId);
				if (entry?.state === "active") await deactivate(opts, entry);
			}),
		stop: () =>
			serial(async () => {
				fired.stopped = true;
				const active = [...entries.values()]
					.filter((e) => e.state === "active")
					.sort((a, b) => (b.activatedAt ?? 0) - (a.activatedAt ?? 0));
				for (const e of active) await deactivate(opts, e);
			}),
		crash: (moduleId, error) =>
			serial(async () => {
				const entry = entries.get(moduleId);
				if (entry?.state !== "active") return;
				await onCrash(opts, entry, error);
				await settle();
			}),
		state: (moduleId) => entries.get(moduleId)?.state,
	};
};
