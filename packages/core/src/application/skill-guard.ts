import {
	type EngineError,
	err,
	ok,
	type Result,
	type SkillRuntimeAdapter,
	SkillRuntimeCheckResultSchema,
	type SkillRuntimeError,
} from "@mete/contracts";
import type { RunContext } from "../domain/run-types.js";
import { needsSkillCheck, skillCheckInput } from "../domain/skill-check.js";
import {
	apply,
	clearTimer,
	type EngineState,
	emit,
	type Live,
} from "./run-state.js";

type Checked = Result<void, SkillRuntimeError>;

const runtimeOf = (s: EngineState) => {
	const found = s.deps.registry.resolve<SkillRuntimeAdapter>("skill.runtime@1");
	return found.ok ? found.value[0].impl : undefined;
};

/**
 * Validates every issued receipt and retained snapshot of the run (ADR-190). Legacy runs
 * without the S2 marker are unaffected; an S2 run with missing state is never treated as empty.
 */
export const checkRunSkills = async (
	s: EngineState,
	context: RunContext,
	signal: AbortSignal,
): Promise<Checked> => {
	if (!needsSkillCheck(context)) return ok(undefined);
	const skills = context.skills;
	if (!skills) return err({ code: "integrity_failed" });
	const runtime = runtimeOf(s);
	if (!runtime) return err({ code: "unavailable" });
	try {
		const parsed = SkillRuntimeCheckResultSchema.safeParse(
			await runtime.check(skillCheckInput(skills), signal),
		);
		if (!parsed.success) return err({ code: "unavailable" });
		return parsed.data.ok ? ok(undefined) : err(parsed.data.error);
	} catch {
		return err({ code: signal.aborted ? "aborted" : "unavailable" });
	}
};

/**
 * A refusal keeps history intact, records the typed block, clears automatic resume and
 * pauses with reason `user`. Nothing is dispatched after it.
 */
export const blockRunSkills = (
	s: EngineState,
	l: Live,
	error: SkillRuntimeError,
) => {
	clearTimer(l);
	const at = s.deps.now();
	apply(s, l, { type: "SKILL_BLOCKED", error });
	for (const { owner } of l.snapshot.context.skills?.contexts ?? [])
		emit(s, l, {
			type: "run.skills.updated",
			payload: { contextId: owner.contextId },
		});
	if (l.snapshot.value === "running" || l.snapshot.value === "queued")
		apply(s, l, { type: "PAUSE", at, reason: "user" });
	else if (l.snapshot.value === "paused") apply(s, l, { type: "HOLD" });
};

/**
 * Checked at the next core boundary before any model, tool, summary or team dispatch (ADR-190).
 * A refusal pauses with the typed block; a stale drive after the await dispatches nothing.
 * Legacy runs return synchronously, so their turn timing is unchanged.
 */
export const skillBoundary = (
	s: EngineState,
	l: Live,
	owns: () => boolean,
): boolean | Promise<boolean> => {
	if (!needsSkillCheck(l.snapshot.context)) return true;
	return checkRunSkills(s, l.snapshot.context, l.all.signal).then((checked) => {
		if (!owns()) return false;
		if (checked.ok) return true;
		blockRunSkills(s, l, checked.error);
		return false;
	});
};

const refused = (error: SkillRuntimeError): EngineError => ({
	code: "failed",
	message: `Skill context is blocked: ${error.code}${error.sourceId ? ` (${error.sourceId})` : ""}.`,
});

/**
 * Manual and timed resume share this check and the admission count while it awaits. A run
 * that left `paused` meanwhile is not resumed; a success clears an earlier block.
 */
export const guardResume = async (
	s: EngineState,
	l: Live,
): Promise<Result<void, EngineError>> => {
	const check = async () =>
		ok(await checkRunSkills(s, l.snapshot.context, l.all.signal));
	const checked = s.gate ? await s.gate.enter(check) : await check();
	if (!checked.ok) return checked;
	if (l.snapshot.value !== "paused")
		return err({
			code: "invalid_state",
			message: `cannot resume a ${l.snapshot.value} run`,
			status: l.snapshot.value,
		});
	if (checked.value.ok) {
		if (l.snapshot.context.skillBlock)
			apply(s, l, { type: "SKILL_BLOCKED", error: undefined });
		return ok(undefined);
	}
	blockRunSkills(s, l, checked.value.error);
	return err(refused(checked.value.error));
};
