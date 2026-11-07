import type { ContextDraft } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { type ContextTarget, contextScope } from "./context-drafts.js";
import type { captureEditorContext } from "./editor-context.js";

type Deps = {
	readonly capture: (
		mode: "file" | "selection",
	) => ReturnType<typeof captureEditorContext>;
	readonly dir: () => string | undefined;
	readonly target: () => ContextTarget | undefined;
	readonly open: () => Promise<void>;
	readonly initial: () => Promise<void>;
	readonly prepare: (scope: string, draft: ContextDraft) => Promise<boolean>;
	readonly reveal: (target: ContextTarget) => Promise<void>;
	readonly warn: (message: string) => void;
};
const preparationFailure = () =>
	nls.localize(
		"mete/context/failed",
		"Could not prepare the attachment. Check the source and limits, then try again; previous attachments are kept.",
	);
const targetFor = async (deps: Deps, dir: string) => {
	const existing = deps.target();
	await deps.open();
	if (deps.dir() !== dir) return undefined;
	if (existing) return deps.target() === existing ? existing : undefined;
	const current = deps.target();
	if (current && current.scope !== contextScope(dir)) return undefined;
	const opening = deps.initial();
	const target = deps.target();
	await opening;
	return target && deps.dir() === dir && deps.target() === target
		? target
		: undefined;
};

/** Snapshot before opening/focusing a panel; only this target's accepted preparation may reveal it. */
export const runEditorContextCommand = async (
	deps: Deps,
	mode: "file" | "selection",
) => {
	const captured = deps.capture(mode);
	const dir = deps.dir();
	if (!captured.ok || !dir) {
		deps.warn(
			nls.localize(
				"mete/context/unavailable",
				"Editor context is unavailable. The previous attachments are kept.",
			),
		);
		return;
	}
	try {
		const target = await targetFor(deps, dir);
		if (!target) return;
		const accepted = await deps.prepare(target.scope, captured.value);
		if (deps.target() !== target || deps.dir() !== dir) return;
		if (accepted) await deps.reveal(target);
		else deps.warn(preparationFailure());
	} catch {
		deps.warn(preparationFailure());
	}
};
