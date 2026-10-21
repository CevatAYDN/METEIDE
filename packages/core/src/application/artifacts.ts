import type { ArtifactMeta, TeamState } from "../domain/team.js";
import { apply, type EngineState, emit, iso, type Live } from "./run-state.js";

// A submitted report becomes its task's Artifact (docs/07): the file in .mete/artifacts/<run id>/
// and its metadata in the snapshot. A guarded report is JSON, any other one Markdown.

const ARTIFACT = "artifact:";

/**
 * Writes the active task's report as its Artifact; undefined when the task names no
 * expected_output or the engine keeps no artifacts, false when the write failed the run.
 */
export const saveArtifact = async (
	s: EngineState,
	l: Live,
	{ report, json }: { report: string; json: boolean },
): Promise<ArtifactMeta | undefined | false> => {
	const { team, task } = l.snapshot.context;
	const out = team?.template.tasks.find((t) => t.id === task)?.expected_output;
	if (!team || !task || !out || !s.deps.artifacts) return undefined;
	const name = `${task}.${json ? "json" : "md"}`;
	const w = await s.deps.artifacts.write({
		runId: l.meta.id,
		name,
		content: report,
	});
	if (!w.ok) {
		const fail = { code: "artifact_failed", message: w.error.message };
		apply(s, l, { type: "FAIL", at: s.deps.now(), ...fail });
		return false;
	}
	const entry = team.tasks[task];
	const prev = entry?.artifact;
	return {
		id: prev?.id ?? s.deps.newId(),
		type: out.slice(ARTIFACT.length),
		...w.value,
		createdBy: entry?.context.agentId ?? "",
		createdAt: prev?.createdAt ?? iso(s.deps.now()),
	};
};

/** artifact.created for a task's first submission, artifact.updated for a later one. */
export const announce = (
	s: EngineState,
	l: Live,
	before: TeamState,
	{ task, artifact }: { task: string; artifact: ArtifactMeta },
) => {
	const entry = before.tasks[task];
	const type = entry?.artifact ? "artifact.updated" : "artifact.created";
	const payload = {
		artifactId: artifact.id,
		type: artifact.type,
		path: artifact.path,
	};
	emit(s, l, { type, payload }, entry?.id);
};
