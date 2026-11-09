import { randomUUID } from "node:crypto";
import {
	type EngineError,
	err,
	ok,
	type Result,
	type RunSkillPolicy,
	type SkillPolicy,
	type SkillRuntimeError,
	type SkillSelectionAdapter,
	SkillSelectionResultSchema,
} from "@mete/contracts";
import type { RunSkillState } from "../domain/skill-state.js";
import type { TeamState } from "../domain/team.js";
import type { EngineState } from "./run-state.js";

const refusal = (error: SkillRuntimeError): EngineError => ({
	code: "bad_input",
	message: `Skill selection was refused: ${error.code}${error.sourceId ? ` (${error.sourceId})` : ""}.`,
});
const unavailable = (): EngineError => ({
	code: "not_supported",
	message: "Skill selection validation is unavailable.",
});

/**
 * ADR-191 preflight before any run exists. Empty selections need no optional skill module;
 * a nonempty one needs `skill.selection@1` and is never silently dropped.
 */
export const preflightSkills = async (
	s: EngineState,
	policy: SkillPolicy,
	signal: AbortSignal,
): Promise<Result<void, EngineError>> => {
	if (policy.selected.length === 0) return ok(undefined);
	const found =
		s.deps.registry.resolve<SkillSelectionAdapter>("skill.selection@1");
	if (!found.ok) return err(unavailable());
	try {
		const raw: unknown = await found.value[0].impl.check(
			{ selected: policy.selected },
			signal,
		);
		const parsed = SkillSelectionResultSchema.safeParse(raw);
		if (!parsed.success) return err(unavailable());
		return parsed.data.ok ? ok(undefined) : err(refusal(parsed.data.error));
	} catch {
		return err(unavailable());
	}
};

/** Fresh single-agent S2 state: one assistant context, no loads yet (ADR-190). */
export const initialSkillState = (
	runId: string,
	policy: SkillPolicy,
	newId: () => string = randomUUID,
): RunSkillState => ({
	runId,
	policy: {
		mode: policy.mode,
		roles: [{ roleId: "assistant", selected: [...policy.selected] }],
	},
	contexts: [
		{
			owner: { runId, contextId: newId() },
			roleId: "assistant",
			snapshots: [],
		},
	],
});

/**
 * A reply's omitted policy inherits only the predecessor's mode; selections and loaded
 * bodies never carry over. A legacy predecessor without S2 state defaults to auto.
 */
export const inheritedSkillPolicy = (
	predecessor: RunSkillState | undefined,
): SkillPolicy => ({
	mode: predecessor?.policy.mode ?? "auto",
	selected: [],
});

const badRole = (roleId: string): EngineError => ({
	code: "bad_input",
	message: `Skill selections name role ${roleId}, which the template does not define.`,
});

/** Every selected role must exist in the decided target; nothing is reinterpreted. */
const checkRoles = (
	policy: RunSkillPolicy,
	team: TeamState | undefined,
): Result<void, EngineError> => {
	const known = new Set(
		team ? team.template.roles.map(({ id }) => id) : ["assistant"],
	);
	const unknown = policy.roles.find(({ roleId }) => !known.has(roleId));
	return unknown ? err(badRole(unknown.roleId)) : ok(undefined);
};

/**
 * run.skills@1.start admission: exact role membership, then an independent ADR-191
 * preflight per role. Team contexts are created per task attempt, never here.
 */
export const admitRunSkills = async (
	s: EngineState,
	runId: string,
	policy: RunSkillPolicy,
	team: TeamState | undefined,
): Promise<Result<RunSkillState, EngineError>> => {
	const roles = checkRoles(policy, team);
	if (!roles.ok) return roles;
	for (const { selected } of policy.roles) {
		const pre = await preflightSkills(
			s,
			{ mode: policy.mode, selected },
			new AbortController().signal,
		);
		if (!pre.ok) return pre;
	}
	if (team) return ok({ runId, policy, contexts: [] });
	const assistant = policy.roles[0]?.selected ?? [];
	return ok(
		initialSkillState(
			runId,
			{ mode: policy.mode, selected: assistant },
			s.deps.newId,
		),
	);
};
