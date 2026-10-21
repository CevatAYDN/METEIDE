import { err, ok, type ProviderError, type Result } from "@mete/contracts";
import { z } from "zod";
import { codeForStatus } from "../domain/errors.js";

// JSON calls to provider endpoints (docs/09, Provider adapter): the request, its errors
// and the body check.

/** GETs, or POSTs `body` to, a JSON endpoint with the key and parses the answer with `schema`. */
export const fetchJson = async <S extends z.ZodType>(
	url: string,
	apiKey: string,
	signal: AbortSignal,
	opts: {
		schema: S;
		fetch?: typeof globalThis.fetch | undefined;
		body?: unknown;
		headers?: Record<string, string> | undefined;
	},
): Promise<Result<z.infer<S>, ProviderError>> => {
	try {
		const post = opts.body !== undefined;
		const res = await (opts.fetch ?? globalThis.fetch)(url, {
			method: post ? "POST" : "GET",
			headers: {
				...opts.headers,
				authorization: `Bearer ${apiKey}`,
				accept: "application/json",
				...(post ? { "content-type": "application/json" } : {}),
			},
			...(post ? { body: JSON.stringify(opts.body) } : {}),
			signal,
		});
		if (!res.ok)
			return err({
				code: codeForStatus(res.status),
				message: `${post ? "POST" : "GET"} ${url} returned ${res.status}`,
				status: res.status,
				headers: res.headers,
			});
		const body = opts.schema.safeParse(await res.json());
		if (!body.success)
			return err({
				code: "server",
				message: `${post ? "POST" : "GET"} ${url} returned an unexpected body`,
			});
		return ok(body.data);
	} catch (error) {
		if (signal.aborted)
			return err({ code: "aborted", message: "the call was aborted" });
		const message = error instanceof Error ? error.message : String(error);
		return err({ code: "network", message });
	}
};

const IdListSchema = z.object({
	data: z.array(z.object({ id: z.string().min(1) })),
});

/** The model ids an endpoint lists in the OpenAI list format. */
export const listModelIds = async (
	url: string,
	apiKey: string,
	signal: AbortSignal,
	opts: {
		fetch?: typeof globalThis.fetch | undefined;
		headers?: Record<string, string> | undefined;
	} = {},
): Promise<Result<string[], ProviderError>> => {
	const list = await fetchJson(url, apiKey, signal, {
		schema: IdListSchema,
		...opts,
	});
	return list.ok ? ok(list.value.data.map((m) => m.id)) : list;
};
