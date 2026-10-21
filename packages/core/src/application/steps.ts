import {
	type ChatChunk,
	type ChatMessage,
	err,
	type LlmChatAdapter,
	type LlmChunk,
	type LlmError,
	ok,
	type Result,
	type SecretsMaskAdapter,
	type ToolCall,
	type ToolContext,
	type VcsGitAdapter,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { z } from "zod";
import type { EventBody } from "../domain/run-events.js";
import {
	allowed,
	type Seat,
	toolName,
	toolSpec,
	WORKSPACE_TOOLS,
} from "../domain/tools.js";

// One model call, one tool call and one checkpoint of a single-agent run (docs/08, Single agent).

type Assistant = Extract<ChatMessage, { role: "assistant" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;
type Finish = Extract<ChatChunk, { type: "finish" }>["reason"];
type ModelChunk = Extract<LlmChunk, { type: "model" }>;

/** What the steps need from the module. */
export type StepDeps = {
	readonly registry: CapabilityRegistry;
	readonly now: () => number;
};

/** Publishes an event of the current run. */
export type Emit = (body: EventBody) => void;

/** How one model call ended; `missing` means no llm.chat@1 adapter is active. */
export type ModelOutcome =
	| {
			readonly kind: "replied";
			readonly message: Assistant;
			readonly finish: Finish;
	  }
	| { readonly kind: "error"; readonly error: LlmError }
	| { readonly kind: "missing" };

const SPECS = WORKSPACE_TOOLS.map((t) => ({ ref: t.ref, spec: toolSpec(t) }));

/** Text the run keeps, with secrets masked (docs/07); kept as is while no secrets.mask@1 is active. */
const masked = async (deps: StepDeps, text: string) => {
	const chain = deps.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	return chain.ok ? (await chain.value[0].impl.mask(text)).text : text;
};

// The reply text becomes the summary and the provider's error text the failure message.
const maskOutcome = async (
	deps: StepDeps,
	o: ModelOutcome,
): Promise<ModelOutcome> => {
	if (o.kind === "replied") {
		const content = await masked(deps, o.message.content);
		return { ...o, message: { ...o.message, content } };
	}
	if (o.kind === "error") {
		const message = await masked(deps, o.error.message);
		return { ...o, error: { ...o.error, message } };
	}
	return o;
};

type Reply = { content: string; readonly calls: ToolCall[] };

const replied = (r: Reply, finish: Finish): ModelOutcome => {
	const toolCalls = r.calls.length > 0 ? { toolCalls: r.calls } : {};
	const message: Assistant = {
		role: "assistant",
		content: r.content,
		...toolCalls,
	};
	return { kind: "replied", message, finish };
};

// Adds a chunk to the reply; returns the outcome once a chunk ends it.
const take = (
	r: Reply,
	c: Exclude<LlmChunk, { type: "model" }>,
): ModelOutcome | undefined => {
	if (c.type === "text") r.content += c.text;
	else if (c.type === "tool-call")
		r.calls.push({ id: c.id, name: c.name, args: c.args });
	else if (c.type === "finish") return replied(r, c.reason);
	else return { kind: "error", error: c.error };
	return undefined;
};

const read = async (
	chunks: AsyncIterable<LlmChunk>,
	onModel: (c: ModelChunk) => void,
): Promise<ModelOutcome> => {
	const r: Reply = { content: "", calls: [] };
	for await (const c of chunks) {
		if (c.type === "model") onModel(c);
		else {
			const end = take(r, c);
			if (end) return end;
		}
	}
	const message = "the model stream ended without a finish";
	return { kind: "error", error: { code: "server", message } };
};

/** Asks the seat's tier for the next reply, offering the seat's workspace tools that are active. */
export const callModel = async (
	deps: StepDeps,
	run: {
		runId: string;
		priority: 0 | 1 | 2;
		messages: readonly ChatMessage[];
		seat: Seat;
	},
	onModel: (c: ModelChunk) => void,
	signal: AbortSignal,
): Promise<ModelOutcome> => {
	const chain = deps.registry.resolve<LlmChatAdapter>("llm.chat@1");
	if (!chain.ok) return { kind: "missing" };
	const tools = SPECS.filter(
		(s) => deps.registry.has(s.ref) && allowed(run.seat, s.ref),
	).map((s) => s.spec);
	const needs = run.seat.needs;
	const chunks = chain.value[0].impl.chat(
		{
			target: { tier: run.seat.tier },
			...(needs.length > 0 ? { needs: [...needs] } : {}),
			runId: run.runId,
			priority: run.priority,
			messages: [...run.messages],
			...(tools.length > 0 ? { tools } : {}),
		},
		signal,
	);
	return maskOutcome(deps, await read(chunks, onModel));
};

/** How one tool call ended; `approval` means the policy asked and nothing ran. */
export type ToolOutcome =
	| { readonly kind: "result"; readonly message: ToolMessage }
	| { readonly kind: "approval"; readonly rule: string };

type Failure = { readonly code: string; readonly message: string };
type AnyTool = {
	run(input: unknown, ctx: ToolContext): Promise<Result<unknown, Failure>>;
};

// The mask's replacement has no JSON-special characters, so the content stays JSON.
const result = async (
	deps: StepDeps,
	call: ToolCall,
	r: Result<unknown, Failure>,
): Promise<ToolOutcome> => {
	const content = await masked(deps, JSON.stringify(r));
	return {
		kind: "result",
		message: { role: "tool", toolCallId: call.id, content },
	};
};

const refused = (deps: StepDeps, call: ToolCall, f: Failure) =>
	result(deps, call, err(f));

/** Runs one tool call after checking its arguments against the schema the model was offered. */
export const callTool = async (
	deps: StepDeps,
	{ call, seat }: { call: ToolCall; seat: Seat },
	ctx: ToolContext,
	emit: Emit,
): Promise<ToolOutcome> => {
	const entry = WORKSPACE_TOOLS.find(
		(t) => toolName(t.ref) === call.name && allowed(seat, t.ref),
	);
	if (!entry)
		return refused(deps, call, {
			code: "bad_input",
			message: `unknown tool ${call.name}`,
		});
	const args = entry.schema.safeParse(call.args);
	if (!args.success)
		return refused(deps, call, {
			code: "bad_input",
			message: z.prettifyError(args.error),
		});
	const chain = deps.registry.resolve<AnyTool>(entry.ref);
	if (!chain.ok)
		return refused(deps, call, {
			code: "capability_missing",
			message: `${entry.ref} is not active`,
		});
	const [adapter] = chain.value;
	const capability = entry.ref;
	emit({
		type: "agent.tool.called",
		payload: { capability, adapterId: adapter.id },
	});
	const t0 = deps.now();
	const out = await adapter.impl.run(args.data, ctx);
	const durationMs = Math.max(0, deps.now() - t0);
	emit({
		type: "agent.tool.completed",
		payload: { capability, ok: out.ok, durationMs },
	});
	if (!out.ok && out.error.code === "approval_required" && "rule" in out.error)
		return { kind: "approval", rule: String(out.error.rule) };
	return result(deps, call, out);
};

/** Records the working tree before a writing step; no vcs.git@1 means no checkpoint (Phase 4). */
export const createCheckpoint = async (
	deps: StepDeps,
	runId: string,
	signal: AbortSignal,
): Promise<Result<string | undefined, string>> => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@1");
	if (!chain.ok) return ok(undefined);
	const r = await chain.value[0].impl.run(
		{ op: "checkpoint.create", runId },
		{ runId, signal },
	);
	if (!r.ok) return err(r.error.message);
	return r.value.op === "checkpoint.create"
		? ok(r.value.ref)
		: err(`unexpected ${r.value.op} result`);
};
