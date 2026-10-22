import type {
	ChatMessage,
	ContentPart,
	ModelInfo,
	ProviderAdapter,
	QuotaUnitSpec,
	SecretsMaskAdapter,
	ToolCall,
} from "@mete/contracts";
import type { Discovered } from "../domain/resolve.js";

// The steps before a call: model discovery and secret masking (docs/09, Gateway).

/** A discovered model with the adapter that serves it. */
export type Offered = Discovered & { readonly adapter: ProviderAdapter };

export type DiscoveryDeps = {
	/** The provider.chat@2 adapters registered now. */
	readonly providers: () => readonly ProviderAdapter[];
	readonly define: (specs: readonly QuotaUnitSpec[]) => void;
	readonly warn: (msg: string) => void;
};

/**
 * Lists each provider's models once and defines its quota units first.
 * shortcut: a listing is kept for the module's lifetime; add a refresh interval
 * once docs set one.
 */
export const createDiscovery = (deps: DiscoveryDeps) => {
	const listed = new Map<string, readonly ModelInfo[]>();
	const list = async (a: ProviderAdapter, signal: AbortSignal) => {
		const known = listed.get(a.id);
		if (known) return known;
		const r = await a.listModels(signal);
		if (!r.ok) {
			deps.warn(`${a.id}: listing models failed: ${r.error.message}`);
			return [];
		}
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
