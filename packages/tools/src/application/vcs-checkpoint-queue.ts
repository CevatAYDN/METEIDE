import { type VcsGitAdapter, VcsGitInputSchema } from "@mete/contracts";

/** Serializes checkpoint allocation per run across every checkout served by one adapter (ADR-181). */
export const serializeCheckpoints = (adapter: VcsGitAdapter): VcsGitAdapter => {
	const tails = new Map<string, Promise<void>>();
	return {
		run: async (input, ctx) => {
			const parsed = VcsGitInputSchema.safeParse(input);
			if (!parsed.success || parsed.data.op !== "checkpoint.create")
				return adapter.run(input, ctx);
			const runId = parsed.data.runId;
			const previous = tails.get(runId) ?? Promise.resolve();
			const result = previous.then(() => adapter.run(parsed.data, ctx));
			// Only the scheduling tail recovers rejection; the caller still receives the exception.
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
		},
	};
};
