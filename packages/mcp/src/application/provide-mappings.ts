import {
	type AdapterMapping,
	type CapabilityRef,
	MAPPABLE_OUTPUTS,
	type McpMapping,
	type McpServer,
} from "@mete/contracts";
import type { ModuleContext } from "@mete/kernel";
import { loadMappings } from "../infrastructure/mapping-files.js";
import { type MappedDeps, mappedAdapter } from "./mapped.js";

// Provides every runnable `implements` entry of the mapping files; whatever is skipped is
// logged with its file and reason, so a missing adapter is never silent (docs/10, level 2).

type Deps = MappedDeps & {
	readonly moduleId: string;
	readonly servers: readonly McpServer[];
};

const skip = (ctx: ModuleContext, deps: Deps, file: string, reason: string) =>
	ctx.logger.warn(
		{ moduleId: deps.moduleId, file, reason },
		"adapter mapping skipped",
	);

// Why a whole mapping cannot run, or undefined when it can.
const refusal = (m: AdapterMapping, deps: Deps, seen: ReadonlySet<string>) => {
	// shortcut: cli and http mappings do not run yet; upgrade when a slice needs one.
	if (m.type !== "mcp") return `type ${m.type} is not supported yet`;
	if (seen.has(m.metadata.id))
		return `mapping id ${m.metadata.id} is used by another file`;
	if (!deps.servers.some((s) => s.id === m.server))
		return `server ${m.server} is not in mcp.yaml`;
	return undefined;
};

const provideEntries = (
	ctx: ModuleContext,
	deps: Deps,
	file: string,
	mapping: McpMapping,
) => {
	for (const [key, entry] of Object.entries(mapping.implements)) {
		const ref = key as CapabilityRef;
		if (!MAPPABLE_OUTPUTS[ref]) {
			skip(ctx, deps, file, `${ref} has no output schema to map onto`);
			continue;
		}
		const impl = mappedAdapter(deps, { mapping, ref, entry });
		ctx.disposables.add(
			ctx.capabilities.provide(ref, {
				id: mapping.metadata.id,
				trust: "first-party",
				features: entry.features,
				impl,
			}),
		);
	}
};

/** Loads the mappings of `dir` and provides each entry under its mapping id. */
export const provideMappings = async (
	ctx: ModuleContext,
	deps: Deps,
	dir: string,
) => {
	const { mappings, broken } = await loadMappings(dir);
	for (const b of broken) skip(ctx, deps, b.file, b.reason);
	const seen = new Set<string>();
	for (const { file, mapping } of mappings) {
		const why = refusal(mapping, deps, seen);
		seen.add(mapping.metadata.id);
		if (why) skip(ctx, deps, file, why);
		else if (mapping.type === "mcp") provideEntries(ctx, deps, file, mapping);
	}
};
