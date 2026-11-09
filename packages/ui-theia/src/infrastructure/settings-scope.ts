import type { Target } from "../application/section-draft.js";

type Retarget = { retarget(target: Target): Promise<void> };
type Reset = { reset(): void };

/** Moves existing settings forms only while their originating workspace is current. */
export const switchSettingsScope = async (input: {
	readonly target: Target;
	readonly current: () => boolean;
	readonly connections?:
		| {
				readonly dir: string | undefined;
				workspace(dir: string | undefined): Promise<void>;
		  }
		| undefined;
	readonly forms?: { retargetAll(target: Target): Promise<void> } | undefined;
	readonly bindings?: Retarget | undefined;
	readonly mcp?: Retarget | undefined;
	readonly catalog?: Reset | undefined;
	readonly tests?: Reset | undefined;
}): Promise<boolean> => {
	const dir = input.connections?.dir;
	if (!input.current()) return false;
	await input.connections?.workspace(undefined);
	if (!input.current()) return false;
	input.catalog?.reset();
	input.tests?.reset();
	await Promise.all([
		input.forms?.retargetAll(input.target),
		input.bindings?.retarget(input.target),
		input.mcp?.retarget(input.target),
	]);
	if (!input.current()) return false;
	await input.connections?.workspace(dir);
	return input.current();
};
