import {
	err,
	ok,
	type RunQuiesceAdapter,
	type SkillError,
	type TeamEngineV3Adapter,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import type { SkillAdmission } from "@mete/security";
import { z } from "zod";
import type { NativeControlsView } from "../domain/native-controls.js";
import { lockHolder, runLockFile } from "../infrastructure/run-lock.js";

type SkillAdmissionApp = {
	readonly registry: CapabilityRegistry;
	readonly workspaceDir: string;
	readonly nativeControls: NativeControlsView;
};
const success = z.strictObject({ ok: z.literal(true), value: z.null() });
const acknowledged = z.object({ ok: z.literal(true) });
const busy = z.strictObject({
	ok: z.literal(false),
	error: z.strictObject({ code: z.literal("failed"), message: z.string() }),
});
const refused = (
	code: SkillError["code"],
	admitted = false,
): SkillAdmission => ({ admitted, result: err({ code }) });

const captureGate = (app: SkillAdmissionApp) => {
	const gate = app.registry.resolve<RunQuiesceAdapter>("run.quiesce@1");
	const engine = app.registry.resolve<TeamEngineV3Adapter>("team.engine@3");
	if (
		!gate.ok ||
		!engine.ok ||
		!app.nativeControls.has(engine.value[0].impl, gate.value[0].impl)
	)
		return undefined;
	return {
		gate: gate.value[0],
		gateImpl: gate.value[0].impl,
		engine: engine.value[0],
		engineImpl: engine.value[0].impl,
	};
};

const currentGate = (
	app: SkillAdmissionApp,
	captured: NonNullable<ReturnType<typeof captureGate>>,
) => {
	const current = captureGate(app);
	return (
		current !== undefined &&
		current.gate === captured.gate &&
		current.gateImpl === captured.gateImpl &&
		current.engine === captured.engine &&
		current.engineImpl === captured.engineImpl
	);
};

const drain = async (
	app: SkillAdmissionApp,
	captured: NonNullable<ReturnType<typeof captureGate>>,
	signal: AbortSignal,
): Promise<SkillAdmission> => {
	let admitted = false;
	try {
		if (!currentGate(app, captured)) return refused("unavailable");
		const raw: unknown = await captured.gateImpl.prepare();
		admitted = acknowledged.safeParse(raw).success;
		if (!success.safeParse(raw).success)
			return refused(
				busy.safeParse(raw).success ? "busy" : "unavailable",
				admitted,
			);
		if (signal.aborted) return refused("aborted", true);
		if (!currentGate(app, captured)) return refused("unavailable", true);
		return { admitted: true, result: ok(undefined) };
	} catch {
		return refused(signal.aborted ? "aborted" : "unavailable", admitted);
	}
};

/** Native idle admission requires this process's lock and the existing engine gate. */
export const admitSkillMutation = async (
	app: SkillAdmissionApp,
	signal: AbortSignal,
): Promise<SkillAdmission> => {
	try {
		if (signal.aborted) return refused("aborted");
		const holder = await lockHolder(runLockFile(app.workspaceDir));
		if (signal.aborted) return refused("aborted");
		if (holder !== process.pid) return refused("unavailable");
		const captured = captureGate(app);
		if (captured) return drain(app, captured, signal);
		return app.registry.has("team.engine@3") ||
			app.registry.has("run.quiesce@1")
			? refused("unavailable")
			: { admitted: true, result: ok(undefined) };
	} catch {
		return refused("unavailable");
	}
};
