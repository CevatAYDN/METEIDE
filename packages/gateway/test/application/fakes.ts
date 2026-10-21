import {
	type ChatChunk,
	type ChatRequest,
	err,
	type LlmChunk,
	type ModelInfo,
	ok,
	type ProviderAdapter,
	type QuotaAmounts,
	type QuotaObservation,
	type QuotaRequest,
	type QuotaReserveAdapter,
	type ReserveFailed,
} from "@mete/contracts";
import type { ChatDeps } from "../../src/application/chat.js";
import type { ModelCall } from "../../src/infrastructure/model-calls.js";

// Hand-written fakes from contracts types; no test reaches a real provider.

export const NOW = Date.parse("2026-10-21T12:00:00Z");
export const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

export const text = (t: string): ChatChunk => ({ type: "text", text: t });
export const done: ChatChunk = {
	type: "finish",
	reason: "stop",
	usage: { prompt: 3, completion: 2 },
};
export const status = (code: number): ChatChunk => ({
	type: "error",
	error: {
		code:
			code === 429 ? "rate_limited" : code >= 500 ? "server" : "bad_request",
		message: String(code),
		status: code,
		headers: new Headers(),
	},
});

/** A provider whose calls answer from `script`, one array per call, the last one repeating. */
export const fakeProvider = (
	id: string,
	script: ChatChunk[][],
	observe: (status: number) => QuotaObservation[] = () => [],
) => {
	const seen: ChatRequest[] = [];
	const adapter: ProviderAdapter = {
		id,
		format: "openai-chat",
		listModels: async () => ok([]),
		async *chat(req, signal) {
			seen.push(req);
			if (signal.aborted) {
				yield { type: "error", error: { code: "aborted", message: "aborted" } };
				return;
			}
			for (const c of script[Math.min(seen.length, script.length) - 1] ?? [])
				yield c;
		},
		quotaUnits: () => [],
		observe: (s) => observe(s),
		privacy: () => ({ trains: false, logs: false, publishes: false }),
	};
	return { adapter, seen };
};

export const offer = (
	adapter: ProviderAdapter,
	id: string,
	contextWindow = 64_000,
) => ({
	adapter,
	privacy: { trains: false, logs: false, publishes: false } as const,
	model: {
		id,
		providerId: adapter.id,
		family: id,
		contextWindow,
		toolCalling: true,
		vision: false,
		free: true,
		deprecated: false,
	} satisfies ModelInfo,
});

export type Settled = {
	id: string;
	actual: QuotaAmounts | null;
	observations: readonly QuotaObservation[];
};

/** A pool that grants the first chain entry whose provider is not closed. */
export const fakeQuota = (closed: Set<string> = new Set()) => {
	const reserved: QuotaRequest[] = [];
	const settled: Settled[] = [];
	let fail: ReserveFailed | undefined;
	const quota: QuotaReserveAdapter = {
		define: () => {},
		reserve: async (req) => {
			reserved.push(req);
			if (fail) return err(fail);
			const hit = req.chain.find((c) => !closed.has(c.providerId));
			if (!hit) throw new Error("fake pool: every entry closed");
			return ok({ id: `r${reserved.length}`, ...hit });
		},
		settle: (id, actual, observations) => {
			settled.push({ id, actual, observations });
			return ok(undefined);
		},
	};
	return {
		quota,
		reserved,
		settled,
		failWith: (f: ReserveFailed) => {
			fail = f;
		},
	};
};

export const deps = (
	over: Partial<ChatDeps> & Pick<ChatDeps, "discover" | "quota">,
) => {
	const waits: number[] = [];
	const calls: ModelCall[] = [];
	const d: ChatDeps = {
		mask: { mask: async (t) => ({ text: t, masked: 0 }) },
		rules: () => ({ allowTraining: false, sensitive: false }),
		sleep: async (ms) => {
			waits.push(ms);
		},
		now: () => NOW,
		record: (c) => calls.push(c),
		...over,
	};
	return { deps: d, waits, calls };
};

export const collect = async (chunks: AsyncIterable<LlmChunk>) => {
	const out: LlmChunk[] = [];
	for await (const c of chunks) out.push(c);
	return out;
};
