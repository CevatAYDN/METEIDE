import type { VcsGitAdapter } from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";

/** One engine owns allocation order across adapter replacements and resumed drives. */
export const createCheckpointQueue = () => {
	const tails = new Map<string, Promise<void>>();
	return async <T>(runId: string, work: () => Promise<T>): Promise<T> => {
		const result = (tails.get(runId) ?? Promise.resolve()).then(work);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		tails.set(runId, tail);
		try {
			return await result;
		} finally {
			if (tails.get(runId) === tail) tails.delete(runId);
		}
	};
};

/** Composition attests implementations, never adapter labels or trust ranks. */
export const verifiedCheckpointAdapter = (deps: {
	readonly registry: CapabilityRegistry;
	readonly checkpointAdapters?: Pick<WeakSet<VcsGitAdapter>, "has"> | undefined;
}) => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	const adapter = chain.ok ? chain.value[0].impl : undefined;
	return adapter && deps.checkpointAdapters?.has(adapter) ? adapter : undefined;
};
