// Public API of this package: types, contracts and the module (CONTRIBUTING.md).

export {
	createLifecycle,
	type Lifecycle,
	type LifecycleOptions,
} from "./application/lifecycle.js";
export {
	type Adapter,
	type AdapterChain,
	type AdapterUnavailable,
	type BindingReader,
	type CapabilityMissing,
	type CapabilityRegistry,
	type Circuit,
	createCapabilityRegistry,
	type FeatureSet,
} from "./domain/capability-registry.js";
export {
	type CircuitBreaker,
	createCircuitBreaker,
} from "./domain/circuit-breaker.js";
export {
	createEventBus,
	type Disposable,
	type EventBus,
	type Handler,
	type HandlerErrorSink,
} from "./domain/event-bus.js";
export type {
	ConfigInvalid,
	ConfigReader,
	DisposableStore,
	Logger,
	MeteModule,
	ModuleContext,
	ModuleError,
	ModuleState,
} from "./domain/module.js";
