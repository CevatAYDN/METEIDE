import { AsyncLocalStorage } from "node:async_hooks";
import type { Transport } from "@modelcontextprotocol/client";

type SendContext = {
	readonly body: string;
	active: boolean;
	endpoint?: string;
};

const messageTarget = (
	input: Parameters<typeof fetch>[0],
	init: RequestInit | undefined,
	context: SendContext | undefined,
	origin: string,
): URL | undefined => {
	if (!context?.active || init?.method !== "POST" || init.body !== context.body)
		return undefined;
	const contentType = new Headers(init.headers).get("content-type");
	if (contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json")
		return undefined;
	const url = new URL(input instanceof Request ? input.url : input);
	if (
		url.protocol !== "https:" ||
		url.origin !== origin ||
		url.username ||
		url.password ||
		url.hash
	)
		return undefined;
	if (context.endpoint && context.endpoint !== url.href) return undefined;
	return url;
};

/** Captures only the installed SSE SDK's public send payload, never auth discovery or redirects. */
export const createSseCredentialEndpoint = (
	fetcher: typeof fetch,
	server: URL,
	endpoints: Set<string>,
) => {
	const sends = new AsyncLocalStorage<SendContext>();
	const wrapped: typeof fetch = async (input, init) => {
		const context = sends.getStore();
		const target = messageTarget(input, init, context, server.origin);
		if (!target || !context) return fetcher(input, init);
		context.endpoint = target.href;
		endpoints.add(target.href);
		// Stop the SDK's redirect wrapper before it can reissue the matching payload.
		const response = await fetcher(input, { ...init, redirect: "manual" });
		if (response.status >= 300 && response.status < 400) {
			await response.body?.cancel();
			throw new Error("MCP credential-bearing redirects are not supported");
		}
		return response;
	};
	const bind = (transport: Transport): void => {
		const send = transport.send.bind(transport);
		transport.send = (message, options) => {
			const context: SendContext = {
				body: JSON.stringify(message),
				active: true,
			};
			return sends.run(context, async () => {
				try {
					await send(message, options);
				} finally {
					context.active = false;
				}
			});
		};
	};
	return { fetch: wrapped, bind };
};
