import type { LookupOptions } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
	type Lookup,
	resolvePublicAddress,
} from "../application/host-check.js";

type LookupCallback = (
	error: NodeJS.ErrnoException | null,
	address: string | { address: string; family: number }[],
	family?: number,
) => void;

/** A Node socket lookup callback that returns only a validated address. */
export const pinnedLookup =
	(lookup: Lookup) =>
	(hostname: string, options: LookupOptions, callback: LookupCallback) => {
		void resolvePublicAddress(lookup, hostname).then((answer) => {
			if (!answer.ok) {
				const error = new Error(answer.error.message) as NodeJS.ErrnoException;
				error.code = answer.error.code === "bad_input" ? "EACCES" : "ENOTFOUND";
				callback(error, "", 0);
				return;
			}
			const family = isIP(answer.value);
			callback(
				null,
				options.all ? [{ address: answer.value, family }] : answer.value,
				family,
			);
		});
	};

/** Makes the outbound Fetch transport replaceable without changing DNS validation. */
export type PinnedFetch = (
	url: URL,
	init: RequestInit,
	address: string,
) => Promise<Response>;

/** Sends the request to its validated address while preserving its original TLS hostname. */
export const nodePinnedFetch: PinnedFetch = async (url, init, address) => {
	const family = isIP(address);
	const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
		url,
		{
			method: init.method,
			headers: Object.fromEntries(new Headers(init.headers).entries()),
			lookup: (_host, options, callback) =>
				callback(null, options.all ? [{ address, family }] : address, family),
			signal: init.signal ?? undefined,
		},
	);
	return new Promise<Response>((resolve, reject) => {
		request.once("error", reject);
		request.once("response", (res) => {
			const body =
				res.statusCode === 204 || res.statusCode === 304
					? null
					: (Readable.toWeb(res) as ReadableStream<Uint8Array>);
			resolve(
				new Response(body, {
					status: res.statusCode ?? 502,
					...(res.statusMessage ? { statusText: res.statusMessage } : {}),
					headers: res.headers as HeadersInit,
				}),
			);
		});
		// web.fetch@1 sends no body; a string or bytes would go, anything else is refused here.
		const body = init.body;
		if (body === undefined || body === null) request.end();
		else if (typeof body === "string" || body instanceof Uint8Array)
			request.end(body);
		else {
			request.destroy(new Error("a request body must be text or bytes"));
		}
	});
};

/** Makes one Fetch-compatible request using a previously validated DNS address. */
export const pinnedFetch = async (
	lookup: Lookup,
	url: URL,
	init: RequestInit,
	options: {
		readonly checkedAddress?: string;
		readonly transport?: PinnedFetch;
	} = {},
): Promise<Response> => {
	const resolved = options.checkedAddress
		? { ok: true as const, value: options.checkedAddress }
		: await resolvePublicAddress(lookup, url.hostname);
	if (!resolved.ok) throw new Error(resolved.error.message);
	return (options.transport ?? nodePinnedFetch)(url, init, resolved.value);
};
