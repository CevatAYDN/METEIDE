import {
	ok,
	type Result,
	type SecretsMaskAdapter,
	type SkillRuntimeError,
	type SkillTrustAdapter,
	type SkillTrustList,
	SkillTrustListSchema,
} from "@mete/contracts";
import {
	callSkill,
	captureSkillReaders,
	type SkillReaderOptions,
	type SkillReaders,
	skillFailure,
} from "./skill-readers.js";

/** Native runtime composition supplies read-only attestations and its current lifetime. */
export type SkillRuntimeReaderOptions = SkillReaderOptions & {
	readonly nativeTrust: Pick<WeakSet<SkillTrustAdapter>, "has">;
	readonly nativeMaskers: Pick<WeakSet<SecretsMaskAdapter>, "has">;
	readonly current: () => boolean;
};
/** Captured native implementations and a guard retaining their exact descriptors. */
export type SkillRuntimeReaders = SkillReaders & {
	readonly trust: SkillTrustAdapter;
};

/** Captures the selected native readers without falling back or trusting labels. */
export const captureSkillRuntimeReaders = (
	opts: SkillRuntimeReaderOptions,
): Result<SkillRuntimeReaders, SkillRuntimeError> => {
	try {
		const readers = captureSkillReaders(opts);
		const trust = opts.registry.resolve<SkillTrustAdapter>("skill.trust@1");
		if (!readers.ok || !trust.ok) return skillFailure();
		const adapter = trust.value[0];
		const impl = adapter.impl;
		const current = () => {
			try {
				const found = opts.registry.resolve("skill.trust@1");
				return (
					opts.current() &&
					readers.value.current() &&
					opts.nativeTrust.has(impl) &&
					opts.nativeMaskers.has(readers.value.masker) &&
					found.ok &&
					found.value[0] === adapter &&
					adapter.impl === impl
				);
			} catch {
				return false;
			}
		};
		return current()
			? ok({ ...readers.value, trust: impl, current })
			: skillFailure();
	} catch {
		return skillFailure();
	}
};

/** Reads complete S1 trust status with strict Results and native continuity across awaits. */
export const readSkillRuntimeTrust = (
	readers: SkillRuntimeReaders,
	signal: AbortSignal,
): Promise<Result<SkillTrustList, SkillRuntimeError>> =>
	callSkill(readers, signal, SkillTrustListSchema, async () => {
		const status = await callSkill(readers, signal, SkillTrustListSchema, () =>
			readers.trust.status(signal),
		);
		if (!status.ok || status.value.complete) return status;
		const diagnostics = [
			...status.value.diagnostics,
			...status.value.entries.flatMap((entry) => entry.diagnostics),
		];
		return skillFailure(
			diagnostics.some(({ code }) => code === "limit_exceeded")
				? "limit_exceeded"
				: "unavailable",
		);
	});
