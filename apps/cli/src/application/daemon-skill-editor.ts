import {
	type DaemonSkillsEditorParams,
	type DaemonSkillsEditorResult,
	err,
	ok,
	type SkillSourceAdapter,
	SkillSourceSnapshotSchema,
} from "@mete/contracts";
import { type SkillApp, skillResult } from "./daemon-skill-adapter.js";

const sourceAdapter = (app: SkillApp) => {
	if (!app.skillSourceAdapters) return undefined;
	const resolved = app.registry.resolve<SkillSourceAdapter>("skill.source@1");
	if (!resolved.ok) return undefined;
	const adapter = resolved.value[0];
	const impl = adapter.impl;
	return app.skillSourceAdapters.has(impl) ? { adapter, impl } : undefined;
};

const currentSourceAdapter = (
	app: SkillApp,
	captured: NonNullable<ReturnType<typeof sourceAdapter>>,
) => {
	const current = sourceAdapter(app);
	return (
		current !== undefined &&
		current.adapter === captured.adapter &&
		current.impl === captured.impl
	);
};

/** Resolve the original relative editor source by opaque identity, never a masked display label. */
export const resolveSkillEditor = async (
	app: SkillApp,
	sessionId: string,
	input: DaemonSkillsEditorParams,
	signal: AbortSignal,
): Promise<DaemonSkillsEditorResult> => {
	if (input.sessionId !== sessionId) return err({ code: "stale" });
	if (signal.aborted) return err({ code: "aborted" });
	try {
		const captured = sourceAdapter(app);
		if (!captured) return err({ code: "unavailable" });
		const raw = await captured.impl.read({ sourceId: input.sourceId }, signal);
		if (signal.aborted) return err({ code: "aborted" });
		if (!currentSourceAdapter(app, captured))
			return err({ code: "unavailable" });
		const result = skillResult(SkillSourceSnapshotSchema, raw);
		if (!result.ok) return result;
		if (result.value.source.sourceId !== input.sourceId)
			return err({ code: "unavailable" });
		return ok({ sessionId, source: result.value.source });
	} catch {
		return err({ code: signal.aborted ? "aborted" : "unavailable" });
	}
};
