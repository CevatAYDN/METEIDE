import type {
	LlmChatAdapter,
	LlmChatRequest,
	LlmChunk,
	PolicyCheckAdapter,
	ToolContext,
} from "@mete/contracts";
import type {
	CreateMessageRequestParams,
	CreateMessageResult,
} from "@modelcontextprotocol/client";
import { SAMPLING_PRIORITY } from "../defaults.js";
import { messagesOf, samplingRefusal, tierOf } from "../domain/sampling.js";
import { permit } from "./permit.js";

// Sampling (docs/10, MCP client): a server asks the client's model a question. policy.check@1
// decides first; an `ask` becomes one question to the user per server and process; then the
// question goes to llm.chat@2 on the budget and signal of the run whose tool call is in flight.

/** Asks the user a yes or no question for a server (or for a capability, when METE itself asks); the host decides how (CLI terminal, desktop dialog). */
export type Confirm = (
	server: string,
	question: string,
	signal: AbortSignal,
) => Promise<boolean>;

/** Answers one sampling request of `server`; a refusal is thrown with its JSON-RPC code, so the server sees it. */
export type Sample = (
	server: string,
	params: CreateMessageRequestParams,
	signal: AbortSignal,
) => Promise<CreateMessageResult>;

export type SamplingDeps = {
	readonly adapterId: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly chat: () => LlmChatAdapter | undefined;
	readonly confirm: Confirm;
	readonly current: (server: string) => ToolContext | undefined;
};

// The code of the MCP specification for a user who rejected a sampling request, and JSON-RPC's.
const USER_REJECTED = -1;
const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;

// The SDK answers a handler's error with its numeric `code` (ADR-163), so this module loads no SDK class.
const refuse = (message: string, code = INVALID_REQUEST) =>
	Object.assign(new Error(message), { code });

const request = (
	p: CreateMessageRequestParams,
	runId: string,
): LlmChatRequest => ({
	target: { tier: tierOf(p.modelPreferences) },
	runId,
	priority: SAMPLING_PRIORITY,
	messages: messagesOf(p),
	...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
	...(p.temperature === undefined ? {} : { temperature: p.temperature }),
});

type Heard = { text: string; model: string; reason: string };

// Folds one streamed piece into what the model said so far; the last model named is the one that answered.
const hear = (heard: Heard, c: LlmChunk) => {
	if (c.type === "text") heard.text += c.text;
	else if (c.type === "model") heard.model = `${c.providerId}/${c.modelId}`;
	else if (c.type === "finish") heard.reason = c.reason;
	else if (c.type === "error")
		throw refuse(`the model call failed: ${c.error.message}`, INTERNAL_ERROR);
};

const answer = async (
	chat: LlmChatAdapter,
	req: LlmChatRequest,
	signal: AbortSignal,
): Promise<CreateMessageResult> => {
	const heard: Heard = { text: "", model: "", reason: "stop" };
	for await (const c of chat.chat(req, signal)) hear(heard, c);
	if (!heard.model) throw refuse("no model answered", INTERNAL_ERROR);
	return {
		role: "assistant",
		content: { type: "text", text: heard.text },
		model: heard.model,
		stopReason: heard.reason === "length" ? "maxTokens" : "endTurn",
	};
};

/** The sampling handler of the client; `confirm` is how the host asks the user. */
export const createSampling = (deps: SamplingDeps): Sample => {
	const granted = new Set<string>();

	const permitted = async (
		server: string,
		ctx: ToolContext,
		signal: AbortSignal,
	) => {
		const check = {
			adapterId: deps.adapterId,
			action: "mcp.sampling",
			capability: "llm.chat@2",
			command: server,
			args: {},
		} as const;
		const v = permit(deps.policy(), check, ctx);
		if (v.ok) return;
		if (v.error.code !== "approval_required")
			throw refuse(`sampling denied: ${v.error.message}`);
		if (granted.has(server)) return;
		const question = `MCP server ${server} wants to ask a model a question, and METE will spend this run's budget on it. Allow it until METE exits?`;
		if (!(await deps.confirm(server, question, signal)))
			throw refuse(`the user declined sampling for ${server}`, USER_REJECTED);
		granted.add(server);
	};

	return async (server, params, signal) => {
		const ctx = deps.current(server);
		if (!ctx?.runId) throw refuse("sampling needs a run in progress to charge");
		const refusal = samplingRefusal(params);
		if (refusal) throw refuse(refusal);
		const chat = deps.chat();
		if (!chat) throw refuse("llm.chat@2 is not provided");
		const both = AbortSignal.any([signal, ctx.signal]);
		await permitted(server, ctx, both);
		return answer(chat, request(params, ctx.runId), both);
	};
};
