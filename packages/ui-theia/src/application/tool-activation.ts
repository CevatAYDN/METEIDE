import type { Result } from "@mete/contracts";

export type ToolActivation = {
	/** A saved row can already be loaded; probe its exact configuration before restarting. */
	readonly probe?: (() => Promise<boolean>) | undefined;
	readonly save: () => Promise<boolean>;
	/** Undefined means not_ready, not idle; only the atomic restart may admit it. */
	readonly status: () => Promise<Result<number | undefined, string>>;
	readonly restart: () => Promise<Result<null, string>>;
	/** Confirms the saved configuration is the effective loaded server, not a shadowed global row. */
	readonly loaded: () => Promise<boolean>;
	readonly test: () => Promise<void>;
	readonly pending: () => void;
};

export type ActivationResult =
	| { readonly kind: "unsaved" | "activated" }
	| { readonly kind: "pending"; readonly activeRuns: number }
	| { readonly kind: "failed"; readonly error: string };

/** Saving is independent of activation; an unknown status must never authorize a restart. */
export const activateTools = async (
	deps: ToolActivation,
): Promise<ActivationResult> => {
	try {
		if (deps.probe && (await deps.probe())) return { kind: "activated" };
		if (!(await deps.save())) return { kind: "unsaved" };
		deps.pending();
		const status = await deps.status();
		if (!status.ok) return { kind: "failed", error: status.error };
		if (status.value !== undefined && status.value > 0)
			return { kind: "pending", activeRuns: status.value };
		const restarted = await deps.restart();
		if (!restarted.ok) return { kind: "failed", error: restarted.error };
		if (!(await deps.loaded())) return { kind: "pending", activeRuns: 0 };
		await deps.test();
		return { kind: "activated" };
	} catch (error) {
		return { kind: "failed", error: String(error) };
	}
};
