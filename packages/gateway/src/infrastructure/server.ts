import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import {
	IdSchema,
	type LlmChatAdapter,
	type LlmChunk,
	type LlmError,
	type ModelRef,
	TierSchema,
	type ToolCall,
} from "@mete/contracts";
import { Hono } from "hono";
import {
	errorResponse,
	toLlmRequest,
	toWireChunk,
	toWireCompletion,
	WireRequestSchema,
} from "./openai-wire.js";

// The local OpenAI-compatible endpoints on 127.0.0.1 (docs/09, Gateway; ARCHITECTURE.md).

export type GatewayServerOptions = {
	readonly chat: LlmChatAdapter;
	readonly models: (signal: AbortSignal) => Promise<ModelRef[]>;
	/** The per-session bearer token the composition root generated. */
	readonly token: string;
	readonly now?: () => number;
	readonly newId?: () => string;
};

type Content = Exclude<LlmChunk, { type: "model" | "error" }>;
type Frame = { id: string; created: number; model: string };

const wireError = (status: 400 | 401, code: string, message: string) =>
	Response.json({ error: { message, type: code, code } }, { status });

const sameToken = (header: string | undefined, token: string) => {
	const given = Buffer.from(header ?? "");
	const want = Buffer.from(`Bearer ${token}`);
	return given.length === want.length && timingSafeEqual(given, want);
};

const runOf = (h: (name: string) => string | undefined) => {
	const runId = IdSchema.safeParse(h("x-mete-run-id"));
	const raw = h("x-mete-priority") ?? "1";
	const priority: 0 | 1 | 2 | undefined =
		raw === "0" ? 0 : raw === "1" ? 1 : raw === "2" ? 2 : undefined;
	return runId.success && priority !== undefined
		? { runId: runId.data, priority }
		: undefined;
};

const failed = (e: LlmError, now: number) => {
	const r = errorResponse(e, now);
	return Response.json(r.body, { status: r.status, headers: r.headers });
};

// Reads model chunks up to the first content or terminal chunk, naming the serving model.
const head = async (
	it: AsyncIterator<LlmChunk>,
	frame: Frame,
): Promise<Exclude<LlmChunk, { type: "model" }> | undefined> => {
	for (;;) {
		const n = await it.next();
		if (n.done) return undefined;
		if (n.value.type !== "model") return n.value;
		frame.model = `${n.value.providerId}/${n.value.modelId}`;
	}
};

const whole = async (
	it: AsyncIterator<LlmChunk>,
	first: Content,
	frame: Frame,
	now: number,
) => {
	let text = "";
	const calls: ToolCall[] = [];
	for (let c: LlmChunk | undefined = first; c; c = await head(it, frame)) {
		if (c.type === "error") return failed(c.error, now);
		if (c.type === "finish")
			return Response.json(toWireCompletion(text, calls, c, frame));
		if (c.type === "text") text += c.text;
		else calls.push({ id: c.id, name: c.name, args: c.args });
	}
	return failed(
		{ code: "network", message: "the stream ended without a finish" },
		now,
	);
};

const sse = (data: unknown, event?: string) =>
	`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

// Pulled chunk by chunk; a client that disconnects cancels the stream, which returns
// the iterator so the pipeline settles its reservation.
const streamed = (
	it: AsyncIterator<LlmChunk>,
	first: Content,
	frame: Frame,
	now: number,
) => {
	const encoder = new TextEncoder();
	const send = (c: ReadableStreamDefaultController<Uint8Array>, text: string) =>
		c.enqueue(encoder.encode(text));
	let pending: Exclude<LlmChunk, { type: "model" }> | undefined = first;
	let calls = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const c = pending ?? (await head(it, frame));
			pending = undefined;
			if (c?.type === "error")
				send(controller, sse(errorResponse(c.error, now).body, "error"));
			else if (c) send(controller, sse(toWireChunk(c, frame, calls)));
			if (c?.type === "tool-call") calls++;
			if (c && c.type !== "error" && c.type !== "finish") return;
			send(controller, sse("[DONE]"));
			controller.close();
		},
		async cancel() {
			await it.return?.();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
};

const readBody = async (raw: Request) => {
	try {
		return WireRequestSchema.safeParse(await raw.json());
	} catch {
		return undefined;
	}
};

const completions = async (
	opts: Required<GatewayServerOptions>,
	raw: Request,
	h: (n: string) => string | undefined,
) => {
	const run = runOf(h);
	if (!run)
		return wireError(
			400,
			"bad_request",
			"X-Mete-Run-Id must be a UUID and X-Mete-Priority 0, 1 or 2",
		);
	const parsed = await readBody(raw);
	if (!parsed?.success)
		return wireError(
			400,
			"bad_request",
			parsed ? parsed.error.message : "the body is not JSON",
		);
	const req = toLlmRequest(parsed.data, run);
	if (!req.ok) return wireError(400, "bad_request", req.error);
	const it = opts.chat.chat(req.value, raw.signal)[Symbol.asyncIterator]();
	const frame = {
		id: opts.newId(),
		created: Math.floor(opts.now() / 1000),
		model: parsed.data.model,
	};
	const first = await head(it, frame);
	const now = opts.now();
	if (!first)
		return failed(
			{ code: "network", message: "the stream ended without a finish" },
			now,
		);
	if (first.type === "error") return failed(first.error, now);
	return parsed.data.stream
		? streamed(it, first, frame, now)
		: whole(it, first, frame, now);
};

const modelList = (refs: readonly ModelRef[]) => ({
	object: "list",
	data: [
		...TierSchema.options.map((t) => ({
			id: `mete/${t}`,
			object: "model",
			created: 0,
			owned_by: "mete",
		})),
		...refs.map((m) => ({
			id: `${m.providerId}/${m.modelId}`,
			object: "model",
			created: 0,
			owned_by: m.providerId,
		})),
	],
});

/** The Hono app behind the endpoints; `/v1/embeddings` and `/v1/rerank` come with the knowledge layer. */
export const createGatewayApp = (options: GatewayServerOptions) => {
	const opts = {
		now: Date.now,
		newId: () => `chatcmpl-${randomUUID()}`,
		...options,
	};
	const app = new Hono();
	app.use("*", async (c, next) => {
		if (!sameToken(c.req.header("authorization"), opts.token))
			return wireError(401, "unauthorized", "missing or wrong session token");
		await next();
	});
	app.get("/v1/models", async (c) =>
		c.json(modelList(await opts.models(c.req.raw.signal))),
	);
	app.post("/v1/chat/completions", (c) =>
		completions(opts, c.req.raw, (n) => c.req.header(n)),
	);
	return app;
};

/** Serves the endpoints on 127.0.0.1 on a free port. */
export const serveGateway = (options: GatewayServerOptions) =>
	new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
		const app = createGatewayApp(options);
		const server = serve(
			{ fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
			(info: AddressInfo) =>
				resolve({
					port: info.port,
					close: () =>
						new Promise<void>((done, fail) =>
							server.close((e) => (e ? fail(e) : done())),
						),
				}),
		);
	});
