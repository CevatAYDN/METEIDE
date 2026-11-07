import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	err,
	ok,
	type PolicyAsk,
	type PolicyCheckInput,
	PolicyCheckInputSchema,
	PolicyForgetInputSchema,
	PolicyGrantRequestSchema,
	PolicyPendingInputSchema,
	type PolicyRequest,
	type PolicyRequestError,
	PolicyRequestSchema,
	type PolicyRequestsAdapter,
	type PolicyVerdict,
	type Result,
} from "@mete/contracts";

type Scope = "once" | "task";
type Entry = { readonly hash: string; readonly request: PolicyRequest };
type State = {
	readonly pending: Map<string, Entry>;
	readonly grants: Map<string, Map<string, Set<Scope>>>;
};

/** Injectable masking and immutable request-id allocation for process-local requests. */
export type PolicyRequestOptions = {
	readonly mask: (text: string) => Promise<string>;
	readonly newId?: () => string;
};
/** Exact policy requests plus the synchronous hooks used by the audited checker. */
export type PolicyRequests = PolicyRequestsAdapter & {
	remember(
		input: PolicyCheckInput,
		verdict: PolicyVerdict,
	): Result<void, PolicyRequestError>;
	take(input: PolicyCheckInput): Scope | undefined;
};
const bad = () =>
	err({ code: "bad_input" as const, message: "invalid policy request input" });
const keyOf = (input: Pick<PolicyCheckInput, "runId" | "agentId">) =>
	input.runId && input.agentId ? `${input.runId}:${input.agentId}` : undefined;

// JSON and deep equality ignore hidden properties; accessors are not stable snapshots.
const dataOnly = (value: unknown, ancestors = new Set<object>()): boolean => {
	if (value === null || typeof value !== "object")
		return typeof value !== "function";
	if (ancestors.has(value)) return false;
	ancestors.add(value);
	const valid = Reflect.ownKeys(value).every((key) => {
		if (Array.isArray(value) && key === "length") return true;
		const property = Object.getOwnPropertyDescriptor(value, key);
		return (
			typeof key === "string" &&
			property?.enumerable === true &&
			"value" in property &&
			dataOnly(property.value, ancestors)
		);
	});
	ancestors.delete(value);
	return valid;
};

// Lossy JSON (undefined, NaN, custom toJSON) must not authorize different original arguments.
const fingerprint = (
	input: PolicyCheckInput,
): Result<string, PolicyRequestError> => {
	try {
		if (!dataOnly(input.args)) return bad();
		const text = JSON.stringify(input.args);
		if (text === undefined || !isDeepStrictEqual(input.args, JSON.parse(text)))
			return bad();
		const identity = [
			input.action,
			input.capability,
			input.adapterId,
			input.path ?? null,
			input.command ?? null,
			text,
		];
		return ok(
			createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
		);
	} catch {
		return bad();
	}
};
const remember = (
	state: State,
	newId: () => string,
	raw: PolicyCheckInput,
	verdict: PolicyVerdict,
): Result<void, PolicyRequestError> => {
	const parsed = PolicyCheckInputSchema.safeParse(raw);
	if (!parsed.success) return bad();
	const input = parsed.data;
	const key = keyOf(input);
	if (!key || verdict.verdict !== "ask") return ok(undefined);
	const hash = fingerprint(input);
	if (!hash.ok) {
		state.pending.delete(key);
		return hash;
	}
	if (state.pending.get(key)?.hash === hash.value) return ok(undefined);
	const request = PolicyRequestSchema.parse({
		runId: input.runId,
		agentId: input.agentId,
		requestId: newId(),
		rule: verdict.rule,
		ask: {
			action: input.action,
			capability: input.capability,
			adapterId: input.adapterId,
			...(input.path === undefined ? {} : { path: input.path }),
			...(input.command === undefined ? {} : { command: input.command }),
		},
	});
	Object.freeze(request.ask);
	state.pending.set(key, { hash: hash.value, request: Object.freeze(request) });
	return ok(undefined);
};
const maskedAsk = async (
	ask: PolicyAsk,
	mask: PolicyRequestOptions["mask"],
) => {
	const display = { ...ask };
	if (display.path !== undefined) display.path = await mask(display.path);
	if (display.command !== undefined)
		display.command = await mask(display.command);
	return display;
};
const pending =
	(
		state: State,
		mask: PolicyRequestOptions["mask"],
	): PolicyRequestsAdapter["pending"] =>
	async (raw) => {
		const input = PolicyPendingInputSchema.safeParse(raw);
		if (!input.success) return bad();
		const key = `${input.data.runId}:${input.data.agentId}`;
		const entry = state.pending.get(key);
		if (!entry) return ok({ requests: [] });
		try {
			const ask = await maskedAsk(entry.request.ask, mask);
			if (state.pending.get(key)?.request.requestId !== entry.request.requestId)
				return ok({ requests: [] });
			return ok({ requests: [{ ...entry.request, ask }] });
		} catch {
			return err({ code: "failed", message: "policy request masking failed" });
		}
	};
const grant =
	(state: State): PolicyRequestsAdapter["grant"] =>
	(raw) => {
		const input = PolicyGrantRequestSchema.safeParse(raw);
		if (!input.success) return bad();
		const { runId, agentId, requestId, scope } = input.data;
		const key = `${runId}:${agentId}`;
		const entry = state.pending.get(key);
		if (!entry || entry.request.requestId !== requestId)
			return err({
				code: "not_found",
				message: "policy request is not pending",
			});
		state.pending.delete(key);
		const grants = state.grants.get(key) ?? new Map<string, Set<Scope>>();
		const scopes = grants.get(entry.hash) ?? new Set<Scope>();
		scopes.add(scope);
		grants.set(entry.hash, scopes);
		state.grants.set(key, grants);
		return ok(undefined);
	};
const take = (state: State, input: PolicyCheckInput): Scope | undefined => {
	const key = keyOf(input);
	if (!key) return undefined;
	const hash = fingerprint(input);
	if (!hash.ok) return undefined;
	const scopes = state.grants.get(key)?.get(hash.value);
	if (scopes?.delete("once")) return "once";
	return !input.tainted && scopes?.has("task") ? "task" : undefined;
};
const forget =
	(state: State): PolicyRequestsAdapter["forget"] =>
	(raw) => {
		const input = PolicyForgetInputSchema.safeParse(raw);
		if (!input.success) return bad();
		const { runId, agentId } = input.data;
		const keys = new Set([...state.pending.keys(), ...state.grants.keys()]);
		for (const key of keys) {
			const matches = agentId
				? key === `${runId}:${agentId}`
				: key.startsWith(`${runId}:`);
			if (!matches) continue;
			state.pending.delete(key);
			state.grants.delete(key);
		}
		return ok(undefined);
	};

/** Creates policy.requests@1; nothing, including raw argument hashes, survives a new store. */
export const createPolicyRequests = ({
	mask,
	newId = randomUUID,
}: PolicyRequestOptions): PolicyRequests => {
	const state: State = { pending: new Map(), grants: new Map() };
	return {
		pending: pending(state, mask),
		grant: grant(state),
		forget: forget(state),
		remember: (input, verdict) => remember(state, newId, input, verdict),
		take: (input) => take(state, input),
	};
};
