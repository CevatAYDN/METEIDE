import { err, ok, type ProviderError, type Result } from "@mete/contracts";
import { z } from "zod";
import { codeForStatus } from "../domain/errors.js";

// JSON calls to provider endpoints (docs/09, Provider adapter): the request, its errors
// and the body check.

const headersOf = (
	apiKey: string,
	opts: {
		headers?: Record<string, string> | undefined;
		auth?: Record<string, string> | undefined;
	},
	post: boolean,
) => ({
	...opts.headers,
	...(opts.auth ?? { authorization: `Bearer ${apiKey}` }),
	accept: "application/json",
	...(post ? { "content-type": "application/json" } : {}),
});

// A failed status keeps its headers for observe(); a body the schema refuses is a server error.
const answerOf = async <S extends z.ZodType>(
	res: Response,
	schema: S,
	call: string,
): Promise<Result<z.infer<S>, ProviderError>> => {
	if (!res.ok)
		return err({
			code: codeForStatus(res.status),
			message: `${call} returned ${res.status}`,
			status: res.status,
			headers: res.headers,
		});
	const body = schema.safeParse(await res.json());
	return body.success
		? ok(body.data)
		: err({ code: "server", message: `${call} returned an unexpected body` });
};

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
		/** Replaces `Authorization: Bearer <key>` for APIs that take the key another way. */
		auth?: Record<string, string> | undefined;
	},
): Promise<Result<z.infer<S>, ProviderError>> => {
	const post = opts.body !== undefined;
	const call = `${post ? "POST" : "GET"} ${url}`;
	try {
		const res = await (opts.fetch ?? globalThis.fetch)(url, {
			method: post ? "POST" : "GET",
			headers: headersOf(apiKey, opts, post),
			...(post ? { body: JSON.stringify(opts.body) } : {}),
			signal,
		});
		return await answerOf(res, opts.schema, call);
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
