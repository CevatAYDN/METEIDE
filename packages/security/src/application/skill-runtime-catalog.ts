import {
	err,
	ok,
	type Result,
	type SkillRuntimeCatalog,
	SkillRuntimeCatalogSchema,
	type SkillRuntimeDescriptor,
	SkillRuntimeDescriptorSchema,
	type SkillRuntimeError,
	type SkillTrustList,
} from "@mete/contracts";
import {
	captureSkillRuntimeReaders,
	readSkillRuntimeTrust,
	type SkillRuntimeReaderOptions,
} from "./skill-runtime-readers.js";

const catalogFailure = (
	error: SkillRuntimeError,
): Result<SkillRuntimeCatalog, SkillRuntimeError> => {
	if (error.code === "aborted" || error.code === "stale") return err(error);
	return ok({ status: "unavailable", entries: [], diagnostics: [error] });
};
const runtimeCurrent = (opts: SkillRuntimeReaderOptions): boolean => {
	try {
		return opts.current();
	} catch {
		return false;
	}
};
const buildCatalog = (
	status: SkillTrustList,
): Result<SkillRuntimeCatalog, SkillRuntimeError> => {
	const entries: SkillRuntimeDescriptor[] = [];
	for (const entry of status.entries) {
		if (entry.status !== "approved") continue;
		const descriptor = SkillRuntimeDescriptorSchema.safeParse({
			version: {
				sourceId: entry.source.sourceId,
				sha256: entry.approvedSha256,
				revision: entry.revision,
			},
			source: entry.source,
			name: entry.metadata?.name,
			description: entry.metadata?.description,
		});
		if (!descriptor.success) return catalogFailure({ code: "unavailable" });
		entries.push(descriptor.data);
	}
	const catalog = SkillRuntimeCatalogSchema.safeParse({
		status: "ready",
		entries,
		diagnostics: [],
	});
	return catalog.success
		? ok(catalog.data)
		: catalogFailure({ code: "budget_exceeded" });
};

/** Projects complete native masked trust status without rereads, previews or truncation. */
export const readSkillRuntimeCatalog = async (
	opts: SkillRuntimeReaderOptions,
	signal: AbortSignal,
): Promise<Result<SkillRuntimeCatalog, SkillRuntimeError>> => {
	if (signal.aborted) return err({ code: "aborted" });
	if (!runtimeCurrent(opts)) return err({ code: "stale" });
	const captured = captureSkillRuntimeReaders(opts);
	const status = captured.ok
		? await readSkillRuntimeTrust(captured.value, signal)
		: captured;
	const result = status.ok
		? buildCatalog(status.value)
		: catalogFailure(status.error);
	const current =
		runtimeCurrent(opts) && (!captured.ok || captured.value.current());
	if (signal.aborted) return err({ code: "aborted" });
	if (!current) return err({ code: "stale" });
	return result;
};
