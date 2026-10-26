import {
	type EngineError,
	err,
	type ModelRef,
	ok,
	pinOf,
	type Result,
	type RunPrefer,
} from "@mete/contracts";
import type { RunContext } from "../domain/run-machine.js";
import { activeRole, activeSeat } from "../domain/team-run.js";
import type { Seat } from "../domain/tools.js";
import { readPins } from "../infrastructure/pins-store.js";
import type { EngineState, Live } from "./run-state.js";

// A run's preferred model (ADR-122): run preference (run start or mete/run.model) takes precedence
// over workspace pin (.mete/pins.yaml), which takes precedence over tier chain default.
// Invalidation uses preferRevision counter so mid-run changes apply on the next model call.

export const isModelRef = (p: RunPrefer): p is ModelRef =>
	typeof p === "object" &&
	p !== null &&
	"providerId" in p &&
	typeof (p as ModelRef).providerId === "string" &&
	"modelId" in p &&
	typeof (p as ModelRef).modelId === "string";

export const runPreferOf = (
	c: RunContext,
	roleId?: string,
): ModelRef | undefined => {
	if (!c.prefer) return undefined;
	if (isModelRef(c.prefer)) return c.team ? undefined : c.prefer;
	return roleId ? c.prefer[roleId] : undefined;
};

const targetRole = (c: RunContext, roleId?: string): string | undefined => {
	if (roleId) return roleId;
	if (c.task) return activeRole(c).roleId;
	return undefined;
};

const updateRolePrefer = (
	current: Record<string, ModelRef>,
	target: string,
	model: ModelRef | null,
): RunPrefer | undefined => {
	if (model === null) {
		delete current[target];
		return Object.keys(current).length > 0 ? current : undefined;
	}
	return { ...current, [target]: model };
};

export const nextPrefer = (
	c: RunContext,
	model: ModelRef | null,
	roleId?: string,
): Result<RunPrefer | undefined, EngineError> => {
	if (!c.team) return ok(model ?? undefined);
	const target = targetRole(c, roleId);
	if (!target || target === "assistant")
		return err({
			code: "bad_input",
			message: "roleId is required for team runs",
		});
	const current = c.prefer && !isModelRef(c.prefer) ? { ...c.prefer } : {};
	return ok(updateRolePrefer(current, target, model));
};

const pinFor = async (s: EngineState, templateId: string, roleId: string) => {
	const workspace = s.deps.templates?.workspace;
	if (!workspace) return undefined;
	const pins = await readPins(workspace);
	if (pins.ok) return pinOf(pins.value, templateId, roleId);
	s.deps.logger.warn({ error: pins.error }, `pins not used: ${pins.error}`);
	return undefined;
};

const activeKey = (c: RunContext) => {
	if (!c.team || !c.task) return { key: "single", roleId: undefined };
	const { roleId, taskId } = activeRole(c);
	return { key: `${taskId}/${roleId}`, roleId };
};

const resolvePrefer = async (
	s: EngineState,
	c: RunContext,
	roleId?: string,
): Promise<ModelRef | undefined> => {
	const runPrefer = runPreferOf(c, roleId);
	if (runPrefer) return runPrefer;
	if (!c.team || !roleId) return undefined;
	return pinFor(s, c.team.template.metadata.id, roleId);
};

/** The seat of the run's active agent, with its preferred model (ADR-122). */
export const pinnedSeat = async (s: EngineState, l: Live): Promise<Seat> => {
	const c = l.snapshot.context;
	const seat = activeSeat(c);
	const { key, roleId } = activeKey(c);
	const revision = c.preferRevision ?? 0;
	if (l.pin?.key === key && l.pin.revision === revision)
		return l.pin.prefer ? { ...seat, prefer: l.pin.prefer } : seat;
	const prefer = await resolvePrefer(s, c, roleId);
	l.pin = { key, revision, prefer };
	return prefer ? { ...seat, prefer } : seat;
};
