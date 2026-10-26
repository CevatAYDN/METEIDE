import {
	type PolicyCheckInput,
	type PolicyGrantAdapter,
	type PolicyGrantInput,
	PolicyGrantInputSchema,
} from "@mete/contracts";
import { covers } from "../domain/grants.js";
import type { PathEnv } from "../domain/patterns.js";

// policy.grant@1 (ADR-121): the human's answers by run, in this process only, so a restart forgets
// them and the call asks again (SECURITY.md, Answering an ask).
// shortcut: a run's grants stay until the process ends, also after the run ended; drop them on
// run.completed if a long-lived daemon ever holds many.

/** The grants and the lookup policy.check@1 makes on an ask. */
export type Grants = PolicyGrantAdapter & {
	/** The scope of the grant that turns this ask into allow, if any; a once grant is used up. */
	take(input: PolicyCheckInput, env: PathEnv): "once" | "run" | undefined;
};

export const createGrants = (): Grants => {
	const byRun = new Map<string, PolicyGrantInput[]>();
	const find = (
		list: readonly PolicyGrantInput[],
		scope: "once" | "run",
		input: PolicyCheckInput,
		env: PathEnv,
	) => list.find((g) => g.scope === scope && covers(g.ask, input, env));
	return {
		grant(raw) {
			// Typed in-process callers cannot normally fail this, so a failure is a bug (ADR-034).
			const g = PolicyGrantInputSchema.parse(raw);
			byRun.set(g.runId, [...(byRun.get(g.runId) ?? []), g]);
		},
		take(input, env) {
			const list = input.runId ? byRun.get(input.runId) : undefined;
			if (!list || !input.runId) return undefined;
			// Once first, since it was given for this very call; it holds on a tainted step, run does not.
			const once = find(list, "once", input, env);
			if (once) {
				byRun.set(
					input.runId,
					list.filter((g) => g !== once),
				);
				return "once";
			}
			return !input.tainted && find(list, "run", input, env)
				? "run"
				: undefined;
		},
	};
};
