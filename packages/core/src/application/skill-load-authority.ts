import {
	SKILL_RUNTIME_LIMITS,
	type SkillRuntimeLoadInput,
} from "@mete/contracts";

/** One live core-owned load operation; checked across every await of the loader. */
export type SkillLoadOperation = {
	/** The exact input object; an equal copy is never admitted. */
	readonly input: SkillRuntimeLoadInput;
	/** True while the owning drive, call and context still hold this load. */
	readonly live: () => boolean;
	/** Masked UTF-8 bytes already retained by the owning context. */
	readonly retainedBytes: number;
	/** Snapshots already retained by the owning context. */
	readonly retainedCount: number;
};

/**
 * Process-local native load authority (ADR-190). Composition hands `admission` to security;
 * it is structurally its SkillLoadAdmission and is never serialized or offered to a model.
 */
export const createSkillLoadAuthority = () => {
	const pending = new Map<SkillRuntimeLoadInput, SkillLoadOperation>();
	const holds = (input: SkillRuntimeLoadInput) => {
		const op = pending.get(input);
		if (!op) return undefined;
		try {
			return op.live() ? op : undefined;
		} catch {
			return undefined;
		}
	};
	return {
		admission: {
			live: (input: SkillRuntimeLoadInput) => holds(input) !== undefined,
			fits: (input: SkillRuntimeLoadInput, maskedBytes: number) => {
				const op = holds(input);
				return (
					op !== undefined &&
					Number.isSafeInteger(maskedBytes) &&
					maskedBytes >= 0 &&
					op.retainedCount < SKILL_RUNTIME_LIMITS.perContext &&
					op.retainedBytes + maskedBytes <= SKILL_RUNTIME_LIMITS.totalBytes
				);
			},
		},
		/** Admits the exact input until the returned release runs. */
		begin: (op: SkillLoadOperation) => {
			pending.set(op.input, op);
			return () => {
				if (pending.get(op.input) === op) pending.delete(op.input);
			};
		},
	};
};

/** The native authority one engine owns. */
export type SkillLoadAuthority = ReturnType<typeof createSkillLoadAuthority>;
