import {
	type CapabilityRef,
	type ChatChunk,
	type ChatMessage,
	err,
	type LlmChatAdapter,
	type LlmChunk,
	type LlmError,
	ok,
	type Result,
	type SecretsMaskAdapter,
	TOOL_CATALOG,
	type ToolCall,
	type ToolCatalogEntry,
	type ToolContext,
	toolName,
	toolSpec,
	type VcsGitAdapter,
} from "@mete/contracts";
import type { AdapterChain, CapabilityRegistry, Logger } from "@mete/kernel";
import { z } from "zod";
import type { EventBody } from "../domain/run-events.js";
import { allowed, EXTERNAL_LABEL, type Seat } from "../domain/tools.js";
import { mcpSpecs, runMcpTool } from "./mcp-steps.js";

// One model call, one tool call and one checkpoint of a single-agent run (docs/08, Single agent).

type Assistant = Extract<ChatMessage, { role: "assistant" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;
type Finish = Extract<ChatChunk, { type: "finish" }>["reason"];
type ModelChunk = Extract<LlmChunk, { type: "model" }>;

/** What the steps need from the module. */
export type StepDeps = {
	readonly registry: CapabilityRegistry;
	readonly logger: Logger;
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

const SPECS = TOOL_CATALOG.map((t) => ({ ref: t.ref, spec: toolSpec(t) }));

/** Text the run keeps, with secrets masked (docs/07); kept as is while no secrets.mask@1 is active. */
export const masked = async (deps: StepDeps, text: string) => {
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
	// A seat without MCP tools calls the model at once, with no wait in between.
	const mcp = mcpSpecs(deps, run.seat, signal);
	const tools = SPECS.filter(
		(s) => deps.registry.has(s.ref) && allowed(run.seat, s.ref),
	)
		.map((s) => s.spec)
		.concat(Array.isArray(mcp) ? mcp : await mcp);
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
	| {
			readonly kind: "result";
			readonly message: ToolMessage;
			/** The result is external content (web.*): labeled, and it taints the attempt. */
			readonly external?: boolean;
	  }
	| { readonly kind: "approval"; readonly rule: string };

type Failure = { readonly code: string; readonly message: string };
type AnyTool = {
	run(input: unknown, ctx: ToolContext): Promise<Result<unknown, Failure>>;
};

// The mask's replacement has no JSON-special characters, so the content stays JSON; external
// content gets a label line before it (SECURITY.md, prompt injection).
const result = async (
	deps: StepDeps,
	call: ToolCall,
	r: Result<unknown, Failure>,
	external = false,
): Promise<ToolOutcome> => {
	const json = await masked(deps, JSON.stringify(r));
	const content = external
		? `${EXTERNAL_LABEL}
${json}`
		: json;
	return {
		kind: "result",
		message: { role: "tool", toolCallId: call.id, content },
		...(external ? { external } : {}),
	};
};

// A call the policy asked about ran nothing: the run pauses for the approval.
const finished = (
	deps: StepDeps,
	call: ToolCall,
	out: Result<unknown, Failure>,
	external: boolean,
): Promise<ToolOutcome> | ToolOutcome => {
	if (!out.ok && out.error.code === "approval_required" && "rule" in out.error)
		return { kind: "approval", rule: String(out.error.rule) };
	return result(deps, call, out, external);
};

const refused = (deps: StepDeps, call: ToolCall, f: Failure) =>
	result(deps, call, err(f));

type Attempt = {
	readonly deps: StepDeps;
	readonly input: unknown;
	readonly ctx: ToolContext;
	readonly emit: Emit;
};

const attempt = async (
	{ deps, input, ctx, emit }: Attempt,
	ref: CapabilityRef,
	adapter: { readonly id: string; readonly impl: AnyTool },
) => {
	emit({
		type: "agent.tool.called",
		payload: { capability: ref, adapterId: adapter.id },
	});
	const t0 = deps.now();
	const out = await adapter.impl.run(input, ctx);
	const durationMs = Math.max(0, deps.now() - t0);
	emit({
		type: "agent.tool.completed",
		payload: {
			capability: ref,
			ok: out.ok,
			durationMs,
			...(out.ok ? {} : { error: { code: out.error.code } }),
		},
	});
	return out;
};

// docs/06, Capability resolution: an io failure moves to the next adapter, each attempt with its
// own events; a write tool never does, so a half-done write is not repeated by another adapter.
const walk = async (
	a: Attempt,
	entry: ToolCatalogEntry,
	chain: AdapterChain<AnyTool>,
) => {
	const [first, ...rest] = chain;
	let out = await attempt(a, entry.ref, first);
	for (const next of entry.write ? [] : rest) {
		if (out.ok || out.error.code !== "io") break;
		out = await attempt(a, entry.ref, next);
	}
	return out;
};

/**
 * Runs a catalog capability for the engine itself, as a verify gate does: the same adapter chain,
 * events and policy as an agent's call, but no model chose it and the seat's list does not apply.
 */
export const runCapability = async (
	deps: StepDeps,
	call: { ref: CapabilityRef; input: unknown },
	ctx: ToolContext,
	emit: Emit,
): Promise<Result<unknown, Failure>> => {
	const entry = TOOL_CATALOG.find((t) => t.ref === call.ref);
	const chain = deps.registry.resolve<AnyTool>(call.ref);
	if (!entry || !chain.ok)
		return err({
			code: "capability_missing",
			message: `${call.ref} is not active`,
		});
	return walk({ deps, input: call.input, ctx, emit }, entry, chain.value);
};

/** Runs one tool call after checking its arguments against the schema the model was offered. */
export const callTool = async (
	deps: StepDeps,
	{ call, seat }: { call: ToolCall; seat: Seat },
	ctx: ToolContext,
	emit: Emit,
): Promise<ToolOutcome> => {
	const entry = TOOL_CATALOG.find(
		(t) => toolName(t.ref) === call.name && allowed(seat, t.ref),
	);
	if (!entry) {
		const mcp = await runMcpTool(deps, { call, seat }, ctx, emit);
		if (mcp) return finished(deps, call, mcp, true);
		return refused(deps, call, {
			code: "bad_input",
			message: `unknown tool ${call.name}`,
		});
	}
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
	const out = await walk(
		{ deps, input: args.data, ctx, emit },
		entry,
		chain.value,
	);
	return finished(deps, call, out, entry.external === true);
};

/** Records the working tree before a writing step; no vcs.git@2 means no checkpoint (Phase 4). */
export const createCheckpoint = async (
	deps: StepDeps,
	runId: string,
	signal: AbortSignal,
): Promise<Result<string | undefined, string>> => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
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
