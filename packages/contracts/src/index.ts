// Public API of this package: types, contracts and the module (CONTRIBUTING.md).
export {
	EVENT_TYPES,
	type EventParseError,
	type EventType,
	type MeteEvent,
	MeteEventSchema,
	parseEvent,
} from "./domain/events.js";
export {
	type CapabilityRef,
	CapabilityRefSchema,
	EventTypeSchema,
	IdSchema,
	ModuleIdSchema,
	TimestampSchema,
} from "./domain/ids.js";
export {
	type ActivationEvent,
	ActivationEventSchema,
	type ManifestParseError,
	type ModuleManifest,
	ModuleManifestSchema,
	PermissionSchema,
	parseManifest,
} from "./domain/manifest.js";
export {
	type AuditFailed,
	type MaskResult,
	type Policy,
	type PolicyAction,
	PolicyActionSchema,
	type PolicyCheckAdapter,
	type PolicyCheckInput,
	PolicyCheckInputSchema,
	PolicySchema,
	type PolicyVerdict,
	PolicyVerdictSchema,
	type SecretsMaskAdapter,
} from "./domain/policy.js";
export { err, ok, type Result } from "./domain/result.js";
export {
	CheckpointKindSchema,
	DecisionSchema,
	MessageKindSchema,
	PauseReasonSchema,
	QuotaUnitSchema,
	TaskStatusSchema,
} from "./domain/states.js";
export type {
	Migration,
	MigrationError,
	ScopedStorage,
	StorageScope,
	StorageSqlAdapter,
} from "./domain/storage.js";
