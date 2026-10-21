// Public API of this package: types, contracts and the module (CONTRIBUTING.md).
export {
	type Adapter,
	type AdapterChain,
	type AdapterUnavailable,
	type BindingReader,
	type CapabilityMissing,
	type CapabilityRegistry,
	createCapabilityRegistry,
	type FeatureSet,
} from "./domain/capability-registry.js";
export {
	createEventBus,
	type Disposable,
	type EventBus,
	type Handler,
	type HandlerErrorSink,
} from "./domain/event-bus.js";
