import type { Result, SkillError, SkillTrustAdapter } from "@mete/contracts";
import { createSkillApprover } from "./skill-approve.js";
import { createSkillDisabler } from "./skill-disable.js";
import type { SkillMutationOptions } from "./skill-mutation.js";
import { createSkillPreviews } from "./skill-previews.js";
import { skillFailure } from "./skill-readers.js";
import { readSkillStatus } from "./skill-status.js";

const read = async <T>(
	active: () => boolean,
	work: () => Promise<Result<T, SkillError>>,
): Promise<Result<T, SkillError>> => {
	try {
		if (!active()) return skillFailure();
		const result = await work();
		return active() ? result : skillFailure();
	} catch {
		return skillFailure();
	}
};

/** One module activation owns its previews, outstanding calls and permanently retired state. */
export const createSkillTrustAdapter = (
	opts: Omit<SkillMutationOptions, "active">,
) => {
	let active = true;
	const pending = new Set<Promise<unknown>>();
	const options = { ...opts, active: () => active };
	const previews = createSkillPreviews(options);
	const approve = createSkillApprover(options, previews);
	const disable = createSkillDisabler(options);
	const track = <T>(operation: Promise<T>): Promise<T> => {
		pending.add(operation);
		return operation.finally(() => pending.delete(operation));
	};
	const impl: SkillTrustAdapter = {
		status: (signal) =>
			track(read(options.active, () => readSkillStatus(options, signal))),
		prepare: (input, signal) =>
			track(read(options.active, () => previews.prepare(input, signal))),
		approve: (input, signal) => track(approve(input, signal)),
		disable: (input, signal) => track(disable(input, signal)),
	};
	return {
		impl,
		async close() {
			active = false;
			previews.clear();
			await Promise.all([...pending]);
		},
	};
};
