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
	type LlmChatAdapter,
	type LlmChatRequest,
	LlmChatRequestSchema,
	type LlmChunk,
	type LlmError,
	type ModelRef,
	ModelRefSchema,
	type PrivacyConfig,
	PrivacyConfigSchema,
	type Tier,
	TierSchema,
} from "./domain/llm.js";
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
export {
	type ChatChunk,
	type ChatMessage,
	type ChatRequest,
	ChatRequestSchema,
	type ContentPart,
	type CustomEndpoint,
	type EmbedRequest,
	type EmbedResponse,
	type ModelInfo,
	ModelInfoSchema,
	type Privacy,
	PrivacySchema,
	type ProviderAdapter,
	type ProviderError,
	type ProvidersConfig,
	ProvidersConfigSchema,
	type RerankRequest,
	type RerankResponse,
	type ToolCall,
	type ToolSpec,
} from "./domain/provider.js";
export {
	type QuotaAmounts,
	QuotaAmountsSchema,
	type QuotaConfig,
	QuotaConfigSchema,
	type QuotaObservation,
	QuotaObservationSchema,
	type QuotaRequest,
	QuotaRequestSchema,
	type QuotaReserveAdapter,
	type QuotaUnitSpec,
	QuotaUnitSpecSchema,
	type Reservation,
	type ReserveFailed,
	type UnknownReservation,
} from "./domain/quota.js";
export { err, ok, type Result } from "./domain/result.js";
export type { SecretError, SecretStore } from "./domain/secrets.js";
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
