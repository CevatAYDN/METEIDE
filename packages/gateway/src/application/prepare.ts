import type {
	ChatMessage,
	ContentPart,
	ModelInfo,
	ProviderAdapter,
	ProviderError,
	QuotaUnitSpec,
	Result,
	SecretsMaskAdapter,
	ToolCall,
	ToolSpec,
} from "@mete/contracts";
import { LISTING_RETRY_MS } from "../defaults.js";
import type { Discovered } from "../domain/resolve.js";

// The steps before a call: model discovery and secret masking (docs/09, Gateway).

/** A discovered model with the adapter that serves it. */
export type Offered = Discovered & { readonly adapter: ProviderAdapter };

export type DiscoveryDeps = {
	readonly mask: SecretsMaskAdapter;
	/** The provider.chat@2 or provider.embed@2 adapters registered now. */
	readonly providers: () => readonly ProviderAdapter[];
	/** How an adapter lists its models; `listModels`, the chat models, when left out. */
	readonly list?: (
		a: ProviderAdapter,
		signal: AbortSignal,
	) => Promise<Result<ModelInfo[], ProviderError>>;
	readonly define: (specs: readonly QuotaUnitSpec[]) => void;
	readonly warn: (msg: string) => void;
	/** The clock the retry of a failed listing reads; `Date.now` when left out. */
	readonly now?: () => number;
};

/**
 * Lists each provider's models once and defines its quota units first; a failed
 * listing is asked again after LISTING_RETRY_MS.
 * shortcut: a listing is kept for the module's lifetime; add a refresh interval
 * once docs set one.
 */
export const createDiscovery = (deps: DiscoveryDeps) => {
	const listed = new Map<string, readonly ModelInfo[]>();
	const failedAt = new Map<string, number>();
	const now = deps.now ?? Date.now;
	const list = async (a: ProviderAdapter, signal: AbortSignal) => {
		const known = listed.get(a.id);
		if (known) return known;
		const failed = failedAt.get(a.id);
		if (failed !== undefined && now() - failed < LISTING_RETRY_MS) return [];
		const r = await (deps.list?.(a, signal) ?? a.listModels(signal));
		if (!r.ok) {
			failedAt.set(a.id, now());
			const masked = await deps.mask.mask(r.error.message);
			deps.warn(`${a.id}: listing models failed: ${masked.text}`);
			return [];
		}
		failedAt.delete(a.id);
		deps.define(a.quotaUnits());
		listed.set(a.id, r.value);
		return r.value;
	};
	return async (signal: AbortSignal): Promise<Offered[]> => {
		const adapters = deps.providers();
		const lists = await Promise.all(adapters.map((a) => list(a, signal)));
		return adapters.flatMap((adapter, i) =>
			(lists[i] ?? []).map((model) => ({
				model,
				privacy: adapter.privacy(model),
				adapter,
			})),
		);
	};
};

type Mask = (text: string) => Promise<string>;

const maskPart = async (p: ContentPart, mask: Mask): Promise<ContentPart> =>
	p.type === "text" ? { ...p, text: await mask(p.text) } : p;

// The replacement has no JSON-special characters, so masked JSON still parses.
const maskArgs = async (c: ToolCall, mask: Mask): Promise<ToolCall> => {
	const raw = JSON.stringify(c.args) ?? "";
	const masked = await mask(raw);
	if (masked === raw) return c;
	try {
		return { ...c, args: JSON.parse(masked) };
	} catch {
		return { ...c, args: masked };
	}
};

const maskMessage = async (
	m: ChatMessage,
	mask: Mask,
): Promise<ChatMessage> => {
	switch (m.role) {
		case "user":
			return typeof m.content === "string"
				? { ...m, content: await mask(m.content) }
				: {
						...m,
						content: await Promise.all(m.content.map((p) => maskPart(p, mask))),
					};
		case "assistant": {
			const content = await mask(m.content);
			if (!m.toolCalls) return { ...m, content };
			const calls = m.toolCalls.map((c) => maskArgs(c, mask));
			return { ...m, content, toolCalls: await Promise.all(calls) };
		}
		default:
			return { ...m, content: await mask(m.content) };
	}
};

/** Every outbound text of a conversation with secrets replaced. */
export const maskMessages = (
	adapter: SecretsMaskAdapter,
	messages: readonly ChatMessage[],
): Promise<ChatMessage[]> => {
	const mask: Mask = async (t) => (await adapter.mask(t)).text;
	return Promise.all(messages.map((m) => maskMessage(m, mask)));
};

/** Tool descriptions with secrets replaced; the JSON schemas are sent as they are. */
export const maskTools = (
	adapter: SecretsMaskAdapter,
	tools: readonly ToolSpec[],
): Promise<ToolSpec[]> =>
	Promise.all(
		tools.map(async (t) => ({
			...t,
			description: (await adapter.mask(t.description)).text,
		})),
	);

/** The messages and tools of a request with secrets replaced. */
export const maskCall = async (
	adapter: SecretsMaskAdapter,
	req: {
		messages: readonly ChatMessage[];
		tools?: readonly ToolSpec[] | undefined;
	},
) => {
	const messages = await maskMessages(adapter, req.messages);
	return req.tools
		? { messages, tools: await maskTools(adapter, req.tools) }
		: { messages };
};
