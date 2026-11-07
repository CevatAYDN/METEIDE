type Options = {
	readonly endpoint: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly signal: AbortSignal;
	readonly endpoints?: ReadonlySet<string>;
};

const resourceTarget = (target: URL, options: Options) => {
	const resource = new URL(options.endpoint);
	if (target.href === resource.href) return true;
	return (
		target.origin === resource.origin &&
		!target.hash &&
		options.endpoints?.has(target.href) === true
	);
};

const requestFor = (request: Request, options: Options) => {
	const target = new URL(request.url);
	if (target.protocol !== "https:" || target.username || target.password)
		throw new Error("MCP authentication requires a secure target");
	const exact = resourceTarget(target, options);
	const headers = new Headers(request.headers);
	if (!exact && /^(Bearer|DPoP)\s/i.test(headers.get("authorization") ?? ""))
		throw new Error("MCP bearer credentials cannot leave their exact endpoint");
	if (exact)
		for (const [name, value] of Object.entries(options.headers ?? {}))
			headers.set(name, value);
	return new Request(request, {
		headers,
		redirect: "manual",
		signal: AbortSignal.any([request.signal, options.signal]),
	});
};

/** Credentials stay on their exact endpoint; OAuth endpoints get only the SDK's own headers. */
export const credentialFetch =
	(fetcher: typeof fetch, options: Options): typeof fetch =>
	async (input, init) => {
		const request = new Request(input, init);
		const outgoing = requestFor(request, options);
		let result: Response;
		try {
			result = await fetcher(outgoing);
		} catch {
			throw new Error("MCP credential request failed");
		}
		if (result.status >= 300 && result.status < 400) {
			await result.body?.cancel();
			throw new Error("MCP credential-bearing redirects are not supported");
		}
		const token =
			outgoing.method === "POST" &&
			outgoing.headers.get("content-type")?.split(";")[0]?.trim() ===
				"application/x-www-form-urlencoded";
		return safeOAuthErrorResponse(result, token);
	};

import { safeOAuthErrorResponse } from "./oauth-error-response.js";
