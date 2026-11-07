import type { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { contextScope } from "../application/context-drafts.js";
import type { MeteEditorContext } from "./editor-context-service.js";

/** Display the same scoped draft that admission uses, including after a late success. */
export const composerContext = (
	workspace: WorkspaceService,
	dir: string | undefined,
	context: MeteEditorContext | undefined,
	goal: string,
) => {
	const current =
		!workspace.tryGetRoots ||
		workspace.tryGetRoots()[0]?.resource.path.fsPath() === dir;
	const scope = dir ? contextScope(dir) : undefined;
	const draft = scope ? context?.drafts.read(scope) : undefined;
	return {
		current,
		scope,
		preparing: draft?.busy === true,
		goal: current ? (draft?.message ?? goal) : "",
	};
};
