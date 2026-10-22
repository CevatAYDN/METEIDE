import {
	err,
	ok,
	type PolicyCheckAdapter,
	type RegistrySearchAdapter,
	RegistrySearchInputSchema,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { z } from "zod";
import {
	OFFICIAL_REGISTRY_URL,
	REGISTRY_SEARCH_LIMIT,
	REGISTRY_TIMEOUT_MS,
} from "../defaults.js";
import {
	OfficialAnswerSchema,
	officialEntries,
} from "../domain/official-registry.js";
import { permit } from "./permit.js";

// registry.search@1 over the official MCP registry (docs/10, Registries): policy.check@1 with
// action net.fetch, then its own fetch, because the registry answers JSON and web.fetch@1 takes pages.

export type RegistryDeps = {
	readonly adapterId: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly fetch: typeof fetch;
};

const io = (message: string) =>
	err<ToolError>({ code: "io", message: `official MCP registry: ${message}` });

/** One GET of the official registry, parsed with `schema`; a 404 is not_found. */
export const readOfficial = async <T>(
	deps: RegistryDeps,
	url: URL,
	schema: z.ZodType<T>,
	signal: AbortSignal,
): Promise<Result<T, ToolError>> => {
	try {
		const res = await deps.fetch(url, { signal });
		const text = await res.text();
		if (res.status === 404)
			return err({
				code: "not_found",
				message: `official MCP registry has no ${url.pathname}`,
			});
		if (!res.ok) return io(`answered ${res.status}: ${text.slice(0, 200)}`);
		const answer = schema.safeParse(JSON.parse(text));
		return answer.success
			? ok(answer.data)
			: io("sent an answer METE cannot read");
	} catch (e) {
		return io(e instanceof Error ? e.message : String(e));
	}
};

const read = async (deps: RegistryDeps, url: URL, signal: AbortSignal) => {
	const answer = await readOfficial(deps, url, OfficialAnswerSchema, signal);
	return answer.ok ? ok(answer.value.servers) : answer;
};

/** The official registry's newest servers that match the query; another kind than mcp finds none. */
export const officialRegistry = (
	deps: RegistryDeps,
): RegistrySearchAdapter => ({
	run: async (raw, ctx) => {
		const input = RegistrySearchInputSchema.safeParse(raw);
		if (!input.success)
			return err({ code: "bad_input", message: z.prettifyError(input.error) });
		const { query, kind } = input.data;
		if (kind && kind !== "mcp") return ok({ entries: [] });
		const url = new URL(OFFICIAL_REGISTRY_URL);
		url.search = new URLSearchParams({
			search: query,
			version: "latest",
			limit: String(REGISTRY_SEARCH_LIMIT),
		}).toString();
		const check = {
			adapterId: deps.adapterId,
			action: "net.fetch",
			capability: "registry.search@1",
			command: url.href,
			args: input.data,
		} as const;
		const allowed = permit(deps.policy(), check, ctx);
		if (!allowed.ok) return allowed;
		const signal = AbortSignal.any([
			ctx.signal,
			AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
		]);
		const servers = await read(deps, url, signal);
		return servers.ok
			? ok({ entries: officialEntries(servers.value) })
			: servers;
	},
});
