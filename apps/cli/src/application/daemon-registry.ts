import {
	DAEMON_METHODS,
	DaemonRegistryPrepareParamsSchema,
	DaemonRegistryPrepareResultSchema,
	DaemonRegistrySearchParamsSchema,
	DaemonRegistrySearchResultSchema,
	err,
	ok,
	type PolicyCheckAdapter,
	type RegistrySearchAdapter,
	type RegistrySearchOutput,
	type RegistrySetupAdapter,
	RegistrySetupResultSchema,
	type Result,
	type ToolError,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { officialInstall } from "@mete/mcp";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { parsed, refused } from "./daemon-errors.js";

/** Read the registry chain for a user search, never a tool installation. */
export const searchRegistry = async (
	registry: CapabilityRegistry,
	query: string,
) => {
	const chain = registry.resolve<RegistrySearchAdapter>("registry.search@1");
	if (!chain.ok)
		return err<ToolError>({
			code: "not_found",
			message: "Registry is unavailable",
		});
	let firstFailure: Result<RegistrySearchOutput, ToolError> | undefined;
	for (const adapter of chain.value) {
		const result = await adapter.impl.run(
			{ query, kind: "mcp" },
			{ signal: new AbortController().signal },
		);
		if (result.ok) {
			if (result.value.entries.length) return result;
			continue;
		}
		if (result.error.code !== "io") return result;
		firstFailure ??= result;
	}
	return firstFailure ?? ok<RegistrySearchOutput>({ entries: [] });
};

/** Ask the existing official adapter for a pinned draft; no configuration writes occur. */
export const prepareRegistry = async (
	registry: CapabilityRegistry,
	name: string,
	fetcher: typeof fetch = fetch,
) => {
	const result = await officialInstall(
		{
			adapterId: "official-mcp-registry",
			fetch: fetcher,
			policy: () => {
				const policy = registry.resolve<PolicyCheckAdapter>("policy.check@1");
				return policy.ok ? policy.value[0].impl : undefined;
			},
		},
		name,
		{ signal: new AbortController().signal },
	);
	return result.ok ? ok({ ...result.value, source: name }) : result;
};

/** Protocol 29 registry reads work before a model account or engine is ready. */
export const serveRegistry = (conn: MessageConnection, app: App) => {
	conn.onRequest(DAEMON_METHODS.registrySetup, async (input: unknown) => {
		const { name } = parsed(DaemonRegistryPrepareParamsSchema.safeParse(input));
		const adapter =
			app.registry.resolve<RegistrySetupAdapter>("registry.setup@1");
		if (!adapter.ok)
			throw refused({
				code: "not_supported",
				message: "Guided registry setup is unavailable",
			});
		const result = await adapter.value[0].impl.prepare(name, {
			signal: new AbortController().signal,
		});
		if (!result.ok)
			throw refused({
				code: "failed",
				message: "Registry setup could not be prepared",
			});
		return parsed(RegistrySetupResultSchema.safeParse(result.value));
	});
	conn.onRequest(DAEMON_METHODS.registrySearch, async (input: unknown) => {
		const { query } = parsed(DaemonRegistrySearchParamsSchema.safeParse(input));
		const result = await searchRegistry(app.registry, query);
		if (!result.ok)
			throw refused({ code: "failed", message: result.error.message });
		return parsed(DaemonRegistrySearchResultSchema.safeParse(result.value));
	});
	conn.onRequest(DAEMON_METHODS.registryPrepare, async (input: unknown) => {
		const { name } = parsed(DaemonRegistryPrepareParamsSchema.safeParse(input));
		const result = await prepareRegistry(app.registry, name);
		if (!result.ok)
			throw refused({ code: "failed", message: result.error.message });
		return parsed(DaemonRegistryPrepareResultSchema.safeParse(result.value));
	});
};
