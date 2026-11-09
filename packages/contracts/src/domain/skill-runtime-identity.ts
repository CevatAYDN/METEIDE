import type { SkillSnapshot } from "./skill-runtime.js";

const metadataCanonical = (
	metadata: SkillSnapshot["inspection"]["metadata"],
) => {
	const pairs = metadata.metadata;
	// JSON.stringify would reorder integer-like map keys numerically.
	const fields = [
		["name", JSON.stringify(metadata.name)],
		["description", JSON.stringify(metadata.description)],
		["license", JSON.stringify(metadata.license)],
		["compatibility", JSON.stringify(metadata.compatibility)],
		[
			"metadata",
			pairs === undefined
				? undefined
				: `{${Object.keys(pairs)
						.sort()
						.map(
							(key) => `${JSON.stringify(key)}:${JSON.stringify(pairs[key])}`,
						)
						.join(",")}}`,
		],
		["allowed-tools", JSON.stringify(metadata["allowed-tools"])],
	] as const;
	return `{${fields
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${JSON.stringify(key)}:${value}`)
		.join(",")}}`;
};

/** Exact receipt-bound JSON with fixed object order and no self-digest (ADR-190). */
export const skillSnapshotCanonical = (
	snapshot: Omit<SkillSnapshot, "payloadSha256">,
): string => {
	const { owner, inspection } = snapshot;
	return [
		`{"receiptId":${JSON.stringify(snapshot.receiptId)},`,
		`"owner":${JSON.stringify({
			runId: owner.runId,
			contextId: owner.contextId,
			taskId: owner.taskId,
			attemptId: owner.attemptId,
		})},`,
		`"inspection":{"source":${JSON.stringify({
			sourceId: inspection.source.sourceId,
			scope: inspection.source.scope,
			path: inspection.source.path,
		})},`,
		`"text":${JSON.stringify(inspection.text)},`,
		`"sha256":${JSON.stringify(inspection.sha256)},`,
		`"metadata":${metadataCanonical(inspection.metadata)}},`,
		`"revision":${JSON.stringify(snapshot.revision)},`,
		`"origin":${JSON.stringify(snapshot.origin)},`,
		`"loadedAt":${JSON.stringify(snapshot.loadedAt)}}`,
	].join("");
};
