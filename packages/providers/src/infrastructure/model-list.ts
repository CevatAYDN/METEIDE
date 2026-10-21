import { err, ok, type ProviderError, type Result } from "@mete/contracts";
import { z } from "zod";
import { codeForStatus } from "../domain/errors.js";

// GET <base>/models in the OpenAI list format (docs/09, Provider adapter).

const ListSchema = z.object({
	data: z.array(z.object({ id: z.string().min(1) })),
});

/** The model ids an endpoint lists. */
export const listModelIds = async (
	url: string,
	apiKey: string,
	signal: AbortSignal,
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<Result<string[], ProviderError>> => {
	try {
		const res = await fetcher(url, {
			headers: { authorization: `Bearer ${apiKey}` },
			signal,
		});
		if (!res.ok)
			return err({
				code: codeForStatus(res.status),
				message: `GET ${url} returned ${res.status}`,
				status: res.status,
				headers: res.headers,
			});
		const list = ListSchema.safeParse(await res.json());
		if (!list.success)
			return err({
				code: "server",
				message: `GET ${url} returned an unexpected body`,
			});
		return ok(list.data.data.map((m) => m.id));
	} catch (error) {
		if (signal.aborted)
			return err({ code: "aborted", message: "the call was aborted" });
		const message = error instanceof Error ? error.message : String(error);
		return err({ code: "network", message });
	}
};
