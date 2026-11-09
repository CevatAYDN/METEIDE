import type {
	DaemonSkillsApproveParams,
	DaemonSkillsApproveResult,
	DaemonSkillsDisableParams,
	DaemonSkillsDisableResult,
	DaemonSkillsEditorParams,
	DaemonSkillsEditorResult,
	DaemonSkillsListResult,
	DaemonSkillsPrepareParams,
	DaemonSkillsPrepareResult,
	Result,
} from "@mete/contracts";
import type { DaemonFailure } from "./daemon-failure.js";

/** Explicit exact-session skill management; never a settings YAML write. */
export interface SkillManagementService {
	skillsList(
		dir: string,
	): Promise<Result<DaemonSkillsListResult, DaemonFailure>>;
	skillsPrepare(
		dir: string,
		input: DaemonSkillsPrepareParams,
	): Promise<Result<DaemonSkillsPrepareResult, DaemonFailure>>;
	/** Resolve the original source for an explicit editor action; never use a display label. */
	skillsEditor(
		dir: string,
		input: DaemonSkillsEditorParams,
	): Promise<Result<DaemonSkillsEditorResult, DaemonFailure>>;
	skillsApprove(
		dir: string,
		input: DaemonSkillsApproveParams,
	): Promise<Result<DaemonSkillsApproveResult, DaemonFailure>>;
	skillsDisable(
		dir: string,
		input: DaemonSkillsDisableParams,
	): Promise<Result<DaemonSkillsDisableResult, DaemonFailure>>;
	/** Read-only host-captured uncertain origin; never acquires or admits work. */
	skillsRecovery(dir: string): Promise<Result<string | null, DaemonFailure>>;
	/** User-requested safe quiesce of the still-current originating transport. */
	skillsRecover(
		dir: string,
		sessionId: string,
	): Promise<Result<null, DaemonFailure>>;
}
