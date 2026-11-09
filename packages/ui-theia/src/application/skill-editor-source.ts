import {
	DaemonSkillsEditorResultSchema,
	err,
	ok,
	type Result,
	type SkillSourceDescriptor,
} from "@mete/contracts";
import type { SkillManagementService } from "../domain/skill-management.js";
import { receiveSkillResponse as receive } from "./skill-response.js";
import type { SkillIssue } from "./skill-state.js";

/** Resolve the original source through its native identity; display paths are never request input. */
export const editorSkillSource = async (
	api: SkillManagementService,
	input: {
		readonly dir: string;
		readonly sessionId: string;
		readonly sourceId: string;
		readonly scope: SkillSourceDescriptor["scope"];
	},
): Promise<Result<SkillSourceDescriptor, SkillIssue>> => {
	try {
		const result = await receive(
			api.skillsEditor(input.dir, {
				sessionId: input.sessionId,
				sourceId: input.sourceId,
			}),
			DaemonSkillsEditorResultSchema,
		);
		if (!result.ok) return err({ code: "transport" });
		if (!result.value.ok) return result.value;
		const native = result.value.value;
		return native.sessionId === input.sessionId &&
			native.source.sourceId === input.sourceId &&
			native.source.scope === input.scope
			? ok(native.source)
			: err({ code: "stale" });
	} catch {
		return err({ code: "transport" });
	}
};
