import { randomUUID } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { z } from "zod";
import {
	OAUTH_CALLBACK_CODE_CHARS,
	OAUTH_CALLBACK_STATE_CHARS,
	OAUTH_CALLBACK_URL_CHARS,
	OAUTH_TIMEOUT_MS,
} from "../defaults.js";

/** A single-use loopback listener, owned and cancelled by its authorization flow. */
export type OAuthCallback = {
	readonly redirectUrl: string;
	readonly wait: () => Promise<Result<string, ToolError>>;
	readonly close: () => Promise<void>;
};
type Options = {
	readonly signal: AbortSignal;
	readonly validate: (url: string) => Result<unknown, string>;
};
const fail = (message: string): Result<never, ToolError> =>
	err({ code: "io", message });
const state = z.string().min(1).max(OAUTH_CALLBACK_STATE_CHARS);
const querySchema = z.union([
	z.object({
		code: z.string().min(1).max(OAUTH_CALLBACK_CODE_CHARS),
		error: z.never().optional(),
		state,
	}),
	z.object({
		error: z.string().min(1).max(OAUTH_CALLBACK_URL_CHARS),
		code: z.never().optional(),
		state,
	}),
]);
const securityParams = [
	"code",
	"state",
	"iss",
	"error",
	"error_description",
	"error_uri",
];
const headers = {
	"Content-Type": "text/plain; charset=utf-8",
	"Cache-Control": "no-store",
	Pragma: "no-cache",
	Connection: "close",
	"X-Content-Type-Options": "nosniff",
};

const bind = (server: Server) =>
	new Promise<Result<number, ToolError>>((resolve) => {
		server.once("error", () => resolve(fail("Callback listener failed")));
		try {
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				resolve(
					address && typeof address !== "string"
						? ok(address.port)
						: fail("Callback listener failed"),
				);
			});
		} catch {
			resolve(fail("Callback listener failed"));
		}
	});

const shutdown = async (
	server: Server,
	bound: ReturnType<typeof bind>,
	sockets: Set<Socket>,
) => {
	const ready = await bound;
	return new Promise<Result<void, ToolError>>((resolve) => {
		try {
			if (!ready.ok) resolve(ok(undefined));
			else
				server.close((error) =>
					resolve(error ? fail("Callback shutdown failed") : ok(undefined)),
				);
		} catch {
			resolve(fail("Callback shutdown failed"));
		}
		for (const socket of sockets) socket.destroy();
	});
};

const pending = (
	server: Server,
	signal: AbortSignal,
	bound: ReturnType<typeof bind>,
) => {
	const sockets = new Set<Socket>();
	const waiting = Promise.withResolvers<Result<string, ToolError>>();
	let settled = false;
	let claimed = false;
	const finish = (result: Result<string, ToolError>) => {
		if (settled) return;
		settled = true;
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		void shutdown(server, bound, sockets).then((closed) =>
			waiting.resolve(closed.ok ? result : err(closed.error)),
		);
	};
	const abort = () => finish(fail("Callback cancelled"));
	const timeout = setTimeout(
		() => finish(fail("Callback expired")),
		OAUTH_TIMEOUT_MS,
	);
	signal.addEventListener("abort", abort, { once: true });
	server.on("error", () => finish(fail("Callback listener failed")));
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		if (settled) socket.destroy();
	});
	return {
		finish,
		claim: () => {
			if (settled || claimed) return false;
			claimed = true;
			return true;
		},
		done: () => settled || claimed,
		wait: () => waiting.promise,
		close: async () => {
			abort();
			await waiting.promise;
		},
	};
};

const callbackUrl = (
	request: IncomingMessage,
	redirect: URL,
	validate: Options["validate"],
) => {
	const parsed = z
		.object({
			method: z.literal("GET"),
			host: z.literal(redirect.host),
			url: z.string().max(OAUTH_CALLBACK_URL_CHARS),
		})
		.safeParse({
			method: request.method,
			host: request.headers.host,
			url: request.url,
		});
	if (!parsed.success) return undefined;
	const raw = parsed.data.url;
	if (raw.split("?")[0] !== redirect.pathname) return undefined;
	const text = `${redirect.origin}${raw}`;
	if (text.length > OAUTH_CALLBACK_URL_CHARS) return undefined;
	try {
		const url = new URL(text);
		const params = url.searchParams;
		if (url.hash) return undefined;
		if (securityParams.some((name) => params.getAll(name).length > 1))
			return undefined;
		if (!querySchema.safeParse(Object.fromEntries(params)).success)
			return undefined;
		const hosts = request.rawHeaders.filter(
			(name, index) => index % 2 === 0 && name.toLowerCase() === "host",
		);
		if (hosts.length !== 1 || !validate(text).ok) return undefined;
		return { url: text, refused: params.has("error") };
	} catch {
		return undefined;
	}
};

const respond = (
	response: ServerResponse,
	accepted: boolean,
	finished?: () => void,
) => {
	response.writeHead(accepted ? 200 : 400, headers);
	response.end(
		accepted
			? "Authorization received. You may close this window."
			: "Invalid request.",
		finished,
	);
};
const handle = (
	request: IncomingMessage,
	response: ServerResponse,
	context: {
		redirect: URL;
		validate: Options["validate"];
		flow: ReturnType<typeof pending>;
	},
) => {
	const { flow } = context;
	const callback = flow.done()
		? undefined
		: callbackUrl(request, context.redirect, context.validate);
	if (!callback || !flow.claim()) {
		respond(response, false);
		return;
	}
	response.once("error", () => flow.finish(fail("Callback response failed")));
	response.once("close", () => flow.finish(fail("Callback response closed")));
	respond(response, true, () =>
		flow.finish(
			callback.refused
				? fail("Callback authorization failed")
				: ok(callback.url),
		),
	);
};

/** Opens an exact-route, validated OAuth callback without launching a browser. */
export const openOAuthCallback = async (
	options: Options,
): Promise<Result<OAuthCallback, ToolError>> => {
	if (options.signal.aborted) return fail("Callback cancelled");
	const pathname = `/callback/${randomUUID()}`;
	const server = createServer();
	const bound = bind(server);
	const flow = pending(server, options.signal, bound);
	server.on("clientError", (_error, socket) => {
		if (!socket.writable || socket.writableEnded) {
			socket.destroy();
			return;
		}
		socket.end(
			"HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nInvalid request.",
			() => socket.destroy(),
		);
	});
	server.on("upgrade", (_request, socket) => socket.destroy());
	const ready = await bound;
	if (!ready.ok) {
		await flow.close();
		return ready;
	}
	if (flow.done()) {
		await flow.close();
		return fail("Callback cancelled");
	}
	const redirect = new URL(`http://127.0.0.1:${ready.value}${pathname}`);
	server.on("request", (request, response) =>
		handle(request, response, { redirect, validate: options.validate, flow }),
	);
	return ok({ redirectUrl: redirect.href, wait: flow.wait, close: flow.close });
};
