import {
	err,
	ok,
	type PolicyCheckAdapter,
	type RegistrySearchAdapter,
	RegistrySearchInputSchema,
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

const read = async (deps: RegistryDeps, url: URL, signal: AbortSignal) => {
	try {
		const res = await deps.fetch(url, { signal });
		const text = await res.text();
		if (!res.ok) return io(`answered ${res.status}: ${text.slice(0, 200)}`);
		const answer = OfficialAnswerSchema.safeParse(JSON.parse(text));
		return answer.success
			? ok(answer.data.servers)
			: io("sent an answer METE cannot read");
	} catch (e) {
		return io(e instanceof Error ? e.message : String(e));
	}
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
