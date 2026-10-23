import type {
	ChatChunk,
	ChatRequest,
	LlmChatRequest,
	ProviderError,
	QuotaAmounts,
	QuotaObservation,
	ToolCall,
} from "@mete/contracts";
import type { Offered } from "./prepare.js";
import type { StallLimits } from "./stall.js";

// The shapes one routed call passes between its steps (docs/09, Gateway).

export type Outcome =
	| {
			readonly kind: "finish";
			readonly reason: Extract<ChatChunk, { type: "finish" }>["reason"];
			readonly usage: { prompt: number; completion: number };
	  }
	| {
			readonly kind: "error";
			readonly error: ProviderError;
			readonly streamed: boolean;
	  };

export type Attempted = {
	readonly outcome: Outcome;
	readonly observations: readonly QuotaObservation[];
};

// What a model streamed, kept for the model_calls row.
export type Seen = { text: string; readonly toolCalls: ToolCall[] };

// One reserved call on one model.
export type Try = {
	readonly o: Offered;
	readonly reservation: string;
	readonly call: ChatRequest;
	readonly req: LlmChatRequest;
	readonly stall: StallLimits;
};

export type Walk = {
	readonly req: LlmChatRequest;
	readonly call: Omit<ChatRequest, "model">;
	readonly chain: readonly Offered[];
	readonly estimate: QuotaAmounts;
	/** Prompt tokens and the completion it may take, for a paid model's cost (ADR-042). */
	readonly tokens: { readonly prompt: number; readonly completion: number };
};

// How the call ended, set before the finish is yielded.
export type Ended = { outcome: Outcome | undefined };
