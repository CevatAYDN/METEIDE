import type {
	ChatChunk,
	ChatMessage,
	ContextSnapshot,
	ConversationCapability,
	PauseReasonSchema,
	RunPrefer,
} from "@mete/contracts";
import type { z } from "zod";
import type { RequestReservation } from "./reservation-schema.js";
import type { TaskSession } from "./task-session-schema.js";
import type { TeamState } from "./team-schema.js";

type PauseReason = z.infer<typeof PauseReasonSchema>;
type Finish = Extract<ChatChunk, { type: "finish" }>["reason"];
type Assistant = Extract<ChatMessage, { role: "assistant" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/** The model behind the run's one agent. */
export type AgentRef = {
	readonly id: string;
	/** The team role it plays; a single agent is role assistant. */
	readonly roleId?: string | undefined;
	readonly providerId: string;
	readonly modelId: string;
	/** The model's family, when the gateway named it (ADR-162). */
	readonly family?: string | undefined;
	/** The model's context window in tokens, when the gateway named it (ADR-169). */
	readonly contextWindow?: number | undefined;
};

/** Everything a run needs to continue after a restart; times are epoch milliseconds. */
export type RunContext = {
	readonly goal: string;
	readonly priority: 0 | 1 | 2;
	readonly messages: readonly ChatMessage[];
	/** Human-selected optional single-agent tools (ADR-180); absent in old snapshots. */
	readonly extraCapabilities?: readonly ConversationCapability[] | undefined;
	/** Masked immutable snapshots sent with this turn only (ADR-183). */
	readonly attachments?: readonly ContextSnapshot[] | undefined;
	/** Model replies of the current attempt; MAX_TURNS limits them. */
	readonly turns: number;
	/** Model replies of the whole run, the cloud requests of the budget. */
	readonly requests: number;
	readonly reservations?: readonly RequestReservation[] | undefined;
	/** Running time before `since`. */
	readonly activeMs: number;
	/** When the current running stretch began. */
	readonly since?: number | undefined;
	/** Index of the last step (assistant message) that has its checkpoint. */
	readonly checkpointed: number;
	/** The file snapshot of that step, in a folder that is not a git repository (ADR-080). */
	readonly snapshot?: string | undefined;
	readonly agent?: AgentRef | undefined;
	readonly pause?:
		| { readonly reason: PauseReason; readonly resumesAt?: string | undefined }
		| undefined;
	readonly summary?: string | undefined;
	readonly error?:
		| { readonly code: string; readonly message: string }
		| undefined;
	readonly startedAt?: number | undefined;
	readonly endedAt?: number | undefined;
	/** A team run's tasks and template (docs/08); absent for a single agent. */
	readonly team?: TeamState | undefined;
	/** The team task whose conversation is in `messages`. */
	readonly task?: string | undefined;
	/** The approver role reviewing `task` in this conversation (docs/08, step 7). */
	readonly review?: string | undefined;
	/** The role answering `task`'s questions in this conversation (docs/08, step 1; ADR-142). */
	readonly clarify?: string | undefined;
	/** A judge chooses among `task`'s attempts in this conversation (ADR-162). */
	readonly judge?: boolean | undefined;
	/** The start brief every conversation of the run opens with (docs/08, Run memory). */
	readonly brief?: string | undefined;
	/** The workspace block every task conversation and the single agent's open with (ADR-126). */
	readonly workspace?: string | undefined;
	/** External content joined this attempt, so its tool calls are tainted (SECURITY.md). */
	readonly tainted?: boolean | undefined;
	/** The writing tool call that started and has no result yet; a crash leaves it here (ADR-177). */
	readonly inFlight?: string | undefined;
	/** The chosen model for the single agent or per role (ADR-122). */
	readonly prefer?: RunPrefer | undefined;
	/** Incremented on each preference change to invalidate seat caches (ADR-122). */
	readonly preferRevision?: number | undefined;
};

/** Inputs to the internal run machine, not event-bus contracts. */
export type RunEvent =
	| { type: "START"; at: number }
	| { type: "REPLIED"; message: Assistant; finish: Finish }
	| { type: "TOOL_STARTED"; callId: string | undefined }
	| { type: "TOOL_DONE"; message: ToolMessage; external?: boolean }
	| { type: "TAINT" }
	| { type: "MODEL"; agent: AgentRef }
	| { type: "TEAM"; team: TeamState }
	| { type: "ACTIVATE"; task: string }
	| { type: "RESERVE"; reservation: RequestReservation; limit: number }
	| { type: "RELEASE"; id: string }
	| {
			type: "WORKER";
			task: string;
			messages: readonly ChatMessage[];
			session: TaskSession;
			/** Completed cloud requests in this step, not an absolute counter. */
			requests: number;
			reservation?: string | undefined;
	  }
	| { type: "PREFER"; prefer: RunPrefer | undefined }
	| { type: "SUMMARIZED"; messages: readonly ChatMessage[] }
	| { type: "CUT"; messages: readonly ChatMessage[] }
	| { type: "LEARNED"; team: TeamState; replied: boolean }
	| { type: "REPAIR"; team: TeamState; content: string }
	| {
			type: "SWITCH";
			task: string;
			team: TeamState;
			messages: readonly ChatMessage[];
			review?: string;
			clarify?: string;
			judge?: boolean;
			/** The attempt goes on where it left off: its turns and taint (SECURITY.md). */
			state?: { readonly turns: number; readonly tainted: boolean };
			session?: TaskSession;
	  }
	| { type: "REVIEWED"; team: TeamState }
	| { type: "CHECKPOINTED"; step: number; snapshot?: string }
	| { type: "PAUSE"; at: number; reason: PauseReason; resumesAt?: string }
	| { type: "RESUME"; at: number }
	| { type: "COMPLETE"; at: number; summary: string }
	| { type: "FAIL"; at: number; code: string; message: string }
	| { type: "CANCEL"; at: number };
