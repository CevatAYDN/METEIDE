import type { ModuleManifest, Result } from "@mete/contracts";
import type { ZodType } from "zod";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { Disposable, EventBus } from "./event-bus.js";

// Module contract from docs/06-kernel-and-modules.md (Kernel API, Module lifecycle).

/** Why `activate` failed; `message` is for logs, users see i18n text. */
export type ModuleError = {
	readonly code: "activation_failed";
	readonly moduleId: string;
	readonly message: string;
};

type LogFn = (fields: Readonly<Record<string, unknown>>, msg: string) => void;

/** Structured logger in pino argument order. */
export type Logger = {
	readonly error: LogFn;
	readonly warn: LogFn;
	readonly info: LogFn;
	readonly debug: LogFn;
};

/** A configuration value that failed its schema, with where it came from. */
export type ConfigInvalid = {
	readonly code: "config_invalid";
	readonly file: string;
	readonly path: string;
	readonly reason: string;
};

/** Typed slices of configuration the loader already validated. */
export interface ConfigReader {
	get<T>(key: string, schema: ZodType<T>): Result<T, ConfigInvalid>;
}

/** Collects what a module created so it can be released at once. */
export type DisposableStore = Disposable & {
	readonly add: (d: Disposable) => void;
};

// shortcut: `storage` and `secrets` are optional in docs/06 and arrive with the storage and security slices.
/** Services the kernel hands a module when it activates. */
export type ModuleContext = {
	readonly capabilities: CapabilityRegistry;
	readonly events: EventBus;
	readonly config: ConfigReader;
	readonly logger: Logger;
	readonly disposables: DisposableStore;
};

/** A unit the kernel loads; `deactivate` MUST dispose everything it created. */
export interface MeteModule {
	readonly manifest: ModuleManifest;
	activate(ctx: ModuleContext): Promise<Result<void, ModuleError>>;
	deactivate(): Promise<void>;
}

/** Lifecycle states; the supervisor adds `restarting` and `disabled`. */
export type ModuleState =
	| "registered"
	| "resolving"
	| "active"
	| "deactivating"
	| "inactive";
