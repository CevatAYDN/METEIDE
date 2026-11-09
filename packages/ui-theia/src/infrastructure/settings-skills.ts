import {
	type OpenerService,
	open,
} from "@theia/core/lib/browser/opener-service";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import type { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import type { MeteDaemonService, Settings } from "../domain/status-service.js";
import { createSkillSettings } from "./skill-settings.js";

/** Connects user-directed skill management to the existing native editor and file watches. */
export const settingsSkills = (input: {
	readonly daemon: MeteDaemonService;
	readonly workspace: WorkspaceService;
	readonly files: FileService;
	readonly openers: OpenerService;
	readonly settings: () => Settings | undefined;
	readonly changed: () => void;
}) =>
	createSkillSettings({
		api: input.daemon,
		dir: async () =>
			(await input.workspace.roots)[0]?.resource.path.fsPath() ?? "",
		listen: (changed) => input.workspace.onWorkspaceChanged(changed),
		changed: input.changed,
		editor: {
			files: input.files,
			globalFile: () => input.settings()?.globalFile,
			open: (uri) => open(input.openers, uri),
		},
	});
