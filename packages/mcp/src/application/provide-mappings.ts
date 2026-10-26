import {
	type AdapterMapping,
	type CapabilityRef,
	type CliMapping,
	MAPPABLE_OUTPUTS,
	type McpMapping,
	type McpServer,
	type ToolAdapter,
} from "@mete/contracts";
import type { ModuleContext } from "@mete/kernel";
import { loadMappings } from "../infrastructure/mapping-files.js";
import { type CliDeps, cliAdapter } from "./cli-mapped.js";
import { type MappedDeps, mappedAdapter } from "./mapped.js";

// Provides every runnable `implements` entry of the mapping files; whatever is skipped is
// logged with its file and reason, so a missing adapter is never silent (docs/10, level 2).

type Deps = MappedDeps &
	CliDeps & {
		readonly moduleId: string;
		readonly servers: readonly McpServer[];
	};

type Entry = {
	readonly ref: CapabilityRef;
	readonly impl: ToolAdapter<unknown, unknown>;
	readonly features: readonly string[];
};

const skip = (ctx: ModuleContext, deps: Deps, file: string, reason: string) =>
	ctx.logger.warn(
		{ moduleId: deps.moduleId, file, reason },
		"adapter mapping skipped",
	);

// Why a whole mapping cannot run, or undefined when it can.
const refusal = (m: AdapterMapping, deps: Deps, seen: ReadonlySet<string>) => {
	// shortcut: http mappings do not run yet; upgrade when a slice needs one.
	if (m.type === "http") return `type ${m.type} is not supported yet`;
	if (seen.has(m.metadata.id))
		return `mapping id ${m.metadata.id} is used by another file`;
	if (m.type === "mcp" && !deps.servers.some((s) => s.id === m.server))
		return `server ${m.server} is not in mcp.yaml`;
	return undefined;
};

const entriesOf = (deps: Deps, mapping: McpMapping | CliMapping): Entry[] =>
	mapping.type === "mcp"
		? Object.entries(mapping.implements).map(([key, entry]) => {
				const ref = key as CapabilityRef;
				const impl = mappedAdapter(deps, { mapping, ref, entry });
				return { ref, impl, features: entry.features };
			})
		: Object.entries(mapping.implements).map(([key, entry]) => {
				const ref = key as CapabilityRef;
				const impl = cliAdapter(deps, { mapping, ref, entry });
				return { ref, impl, features: [] };
			});

const provideEntries = (
	ctx: ModuleContext,
	deps: Deps,
	file: string,
	mapping: McpMapping | CliMapping,
) => {
	for (const { ref, impl, features } of entriesOf(deps, mapping)) {
		if (!MAPPABLE_OUTPUTS[ref]) {
			skip(ctx, deps, file, `${ref} has no output schema to map onto`);
			continue;
		}
		ctx.disposables.add(
			ctx.capabilities.provide(ref, {
				id: mapping.metadata.id,
				trust: "first-party",
				features,
				impl,
			}),
		);
	}
};

const provideFolder = async (
	ctx: ModuleContext,
	deps: Deps,
	dir: string,
	seen: Set<string>,
) => {
	const { mappings, broken } = await loadMappings(dir);
	for (const b of broken) skip(ctx, deps, b.file, b.reason);
	for (const { file, mapping } of mappings) {
		const why = refusal(mapping, deps, seen);
		seen.add(mapping.metadata.id);
		if (why) skip(ctx, deps, file, why);
		else if (mapping.type !== "http") provideEntries(ctx, deps, file, mapping);
	}
};

/** Loads the mappings of each folder in order and provides each entry under its mapping id. */
export const provideMappings = async (
	ctx: ModuleContext,
	deps: Deps,
	dirs: readonly string[],
) => {
	const seen = new Set<string>();
	for (const dir of dirs) await provideFolder(ctx, deps, dir, seen);
};
