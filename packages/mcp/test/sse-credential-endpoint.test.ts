import { McpServerSchema } from "@mete/contracts";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { credentialFetch } from "../src/infrastructure/credential-fetch.js";
import { createSseCredentialEndpoint } from "../src/infrastructure/sse-credential-endpoint.js";
import { openTransport } from "../src/infrastructure/transport.js";

const root = "https://fixture.invalid/sse";
const endpoint = "https://fixture.invalid/messages?session=one";
const message = {
	jsonrpc: "2.0",
	id: 1,
	method: "ping",
} satisfies JSONRPCMessage;
const json = (body = JSON.stringify(message)): RequestInit => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body,
});
const setup = (
	fetcher: typeof fetch = async () => new Response(null, { status: 202 }),
	send?: (fetcher: typeof fetch, message: JSONRPCMessage) => Promise<void>,
) => {
	const endpoints = new Set<string>();
	const capture = createSseCredentialEndpoint(
		fetcher,
		new URL(root),
		endpoints,
	);
	const transport: Transport = {
		start: async () => {},
		close: async () => {},
		send: async (outgoing) => {
			if (send) await send(capture.fetch, outgoing);
			else await capture.fetch(endpoint, json(JSON.stringify(outgoing)));
		},
	};
	capture.bind(transport);
	return { capture, transport, endpoints };
};

describe("SSE credential endpoint send boundary", () => {
	it("registers the exact message URL before delegating fetch", async () => {
		const { transport, endpoints } = setup(async (input) => {
			expect(endpoints.has(String(input))).toBe(true);
			return new Response(null, { status: 202 });
		});
		await transport.send(message);
		expect([...endpoints]).toEqual([endpoint]);
	});

	it("does not register a matching POST outside send", async () => {
		const { capture, endpoints } = setup();
		await capture.fetch(endpoint, json());
		expect(endpoints.size).toBe(0);
	});

	const rejected: [string, string, RequestInit][] = [
		["different payload", endpoint, json('{"client_name":"fixture"}')],
		["different origin", "https://other.invalid/messages", json()],
		["userinfo", "https://user:secret@fixture.invalid/messages", json()],
		["fragment", `${endpoint}#fragment`, json()],
		["insecure", "http://fixture.invalid/messages", json()],
		["wrong method", endpoint, { ...json(), method: "PUT" }],
		[
			"wrong content type",
			endpoint,
			{ ...json(), headers: { "content-type": "text/plain" } },
		],
		[
			"missing body",
			endpoint,
			{ method: "POST", headers: { "content-type": "application/json" } },
		],
	];
	it.each(rejected)(
		"does not register %s even during send",
		async (_name, url, init) => {
			const { transport, endpoints } = setup(undefined, async (fetcher) => {
				await fetcher(url, init);
			});
			await transport.send(message);
			expect(endpoints.size).toBe(0);
		},
	);

	it("isolates concurrent payloads and expires a completed send context", async () => {
		const first = Promise.withResolvers<void>();
		const second = Promise.withResolvers<void>();
		let later: Promise<void> | undefined;
		const { transport, endpoints } = setup(
			undefined,
			async (fetcher, outgoing) => {
				if ("id" in outgoing && outgoing.id === 1) {
					await first.promise;
					await fetcher(endpoint, json());
					later = second.promise.then(async () => {
						await fetcher("https://fixture.invalid/late", json());
					});
				} else {
					first.resolve();
					await fetcher("https://fixture.invalid/wrong", json());
				}
			},
		);
		await Promise.all([
			transport.send(message),
			transport.send({ ...message, id: 2 }),
		]);
		second.resolve();
		await later;
		expect([...endpoints]).toEqual([endpoint]);
	});

	it.each([202, 307])(
		"never registers a second URL after HTTP %s",
		async (status) => {
			const { transport, endpoints } = setup(
				async () => new Response(null, { status }),
				async (fetcher) => {
					await fetcher(endpoint, json());
					await fetcher("https://fixture.invalid/arbitrary", json());
				},
			);
			const sent = transport.send(message);
			if (status === 307) await expect(sent).rejects.toThrow("redirects");
			else await sent;
			expect([...endpoints]).toEqual([endpoint]);
		},
	);
});

describe("installed SDK SSE advertised endpoint", () => {
	const open = async (advertised: string, postStatus = 202) => {
		const endpoints = new Set<string>();
		const seen: Request[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			seen.push(request);
			if (request.method === "POST")
				return new Response(null, {
					status: postStatus,
					headers: { location: "https://fixture.invalid/redirected" },
				});
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						request.signal.addEventListener("abort", () => controller.close(), {
							once: true,
						});
						controller.enqueue(
							new TextEncoder().encode(
								`event: endpoint\ndata: ${advertised}\n\n`,
							),
						);
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		};
		const fetch = credentialFetch(fetcher, {
			endpoint: root,
			endpoints,
			headers: {
				authorization: "Bearer sentinel",
				"x-api-key": "manual-sentinel",
			},
			signal: new AbortController().signal,
		});
		const opened = await openTransport(
			McpServerSchema.parse({
				id: "fixture",
				transport: "sse",
				url: root,
			}),
			{ fetch, credentialEndpoints: endpoints },
		);
		return { ...opened, endpoints, seen, fetch };
	};

	it("sends credentials to the actual SDK-validated session URL", async () => {
		const { transport, endpoints, seen, fetch } = await open(
			"/messages?session=one",
		);
		try {
			await transport.start();
			await transport.send(message);
			expect([...endpoints]).toEqual([endpoint]);
			expect(seen.map((request) => request.url)).toEqual([root, endpoint]);
			expect(seen[1]?.headers.get("authorization")).toBe("Bearer sentinel");
			expect(seen[1]?.headers.get("x-api-key")).toBe("manual-sentinel");
			await expect(
				fetch("https://fixture.invalid/arbitrary", {
					...json(),
					headers: { authorization: "Bearer sentinel" },
				}),
			).rejects.toThrow("exact endpoint");
		} finally {
			await transport.close();
		}
	});

	it("refuses the SDK's same-origin redirect without blessing its destination", async () => {
		const { transport, endpoints, seen } = await open(
			"/messages?session=one",
			307,
		);
		try {
			await transport.start();
			await expect(transport.send(message)).rejects.toThrow();
			expect(seen.map((request) => request.url)).toEqual([root, endpoint]);
			expect(endpoints.has("https://fixture.invalid/redirected")).toBe(false);
			expect(seen[1]?.redirect).toBe("manual");
		} finally {
			await transport.close();
		}
	});

	it("leaves a rejected advertised origin unregistered", async () => {
		const { transport, endpoints, seen } = await open(
			"https://other.invalid/messages",
		);
		try {
			await expect(transport.start()).rejects.toThrow("origin");
			expect(endpoints.size).toBe(0);
			expect(seen.map((request) => request.url)).toEqual([root]);
		} finally {
			await transport.close();
		}
	});
});
