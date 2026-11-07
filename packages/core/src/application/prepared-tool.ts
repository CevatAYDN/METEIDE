import { isAbsolute, relative, sep } from "node:path";
import {
	type CapabilityRef,
	type Result,
	type ToolCall,
	type ToolContext,
	type ToolIsolationAdapter,
	type ToolIsolationInput,
	ToolIsolationSchema,
	toolEntry,
	type VcsGitAdapter,
} from "@mete/contracts";
import type { AdapterChain, CapabilityRegistry } from "@mete/kernel";
import { z } from "zod";

/** The minimal callable shape shared by resolved tool implementations. */
export type AnyTool = {
	run(
		input: unknown,
		ctx: ToolContext,
	): Promise<Result<unknown, { code: string; message: string }>>;
};

/** The checked writer implementation set; it may never resolve a new fallback at dispatch. */
export type PreparedTool = {
	readonly ref: CapabilityRef;
	readonly chain: AdapterChain<AnyTool>;
	readonly root: string;
	readonly checkpoint?: VcsGitAdapter;
};

const claim = z.strictObject({
	ok: z.literal(true),
	value: ToolIsolationSchema,
});

/** True when either canonical root contains the other. */
export const rootsOverlap = (a: string, b: string): boolean => {
	const inside = (root: string, path: string) => {
		const rel = relative(root, path);
		return (
			rel === "" ||
			(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
		);
	};
	return inside(a, b) || inside(b, a);
};

/** Reject disposed, replaced, reordered or newly added adapters before executing a prepared call. */
export const preparedCurrent = (
	registry: CapabilityRegistry,
	prepared: PreparedTool,
) => {
	const current = registry.resolve<AnyTool>(prepared.ref);
	const checkpoint = registry.resolve<VcsGitAdapter>("vcs.git@2");
	return (
		(!prepared.checkpoint ||
			(checkpoint.ok && checkpoint.value[0].impl === prepared.checkpoint)) &&
		current.ok &&
		current.value.length === prepared.chain.length &&
		current.value.every((adapter, index) => adapter === prepared.chain[index])
	);
};

const inspectedRoot = async (
	adapter: ToolIsolationAdapter,
	input: ToolIsolationInput,
	signal: AbortSignal,
) => {
	const raw: unknown = await adapter.inspect(input, signal);
	const parsed = claim.safeParse(raw);
	if (!parsed.success || parsed.data.value.scope !== "worktree")
		return undefined;
	return isAbsolute(parsed.data.value.root)
		? parsed.data.value.root
		: undefined;
};

const chainRoot = async (
	chain: AdapterChain<AnyTool>,
	descriptors: AdapterChain<ToolIsolationAdapter>,
	input: Omit<ToolIsolationInput, "adapterId">,
	signal: AbortSignal,
) => {
	let root: string | undefined;
	for (const adapter of chain) {
		const descriptor = descriptors.find(
			(d) => d.id === adapter.id && d.trust === adapter.trust,
		);
		if (!descriptor) return undefined;
		const here = await inspectedRoot(
			descriptor.impl,
			{ ...input, adapterId: adapter.id },
			signal,
		);
		if (!here || (root !== undefined && relative(root, here) !== ""))
			return undefined;
		root = here;
	}
	return root;
};

/** Inspects every reachable implementation; absence of evidence preserves exclusive execution. */
export const prepareWriter = async (
	registry: CapabilityRegistry,
	call: ToolCall,
	cwd: string,
	signal: AbortSignal,
): Promise<PreparedTool | undefined> => {
	const entry = toolEntry(call.name);
	if (!entry?.write || !entry.schema.safeParse(call.args).success)
		return undefined;
	const chain = registry.resolve<AnyTool>(entry.ref);
	const descriptors =
		registry.resolve<ToolIsolationAdapter>("tool.isolation@1");
	if (!chain.ok || !descriptors.ok || signal.aborted) return undefined;
	const root = await chainRoot(
		chain.value,
		descriptors.value,
		{ capability: entry.ref, input: call.args, cwd },
		signal,
	);
	if (!root || signal.aborted) return undefined;
	const prepared = { ref: entry.ref, chain: chain.value, root };
	return preparedCurrent(registry, prepared) ? prepared : undefined;
};
