import type {
	DaemonRunSkillsReadResult,
	DaemonSkillsRuntimeResult,
	Result,
	RunSkillsReadInput,
} from "@mete/contracts";
import type { DaemonFailure } from "./daemon-failure.js";

/** S2 catalog and authenticated history reads; transport and runtime failures stay distinct. */
export interface SkillRuntimeService {
	skillsRuntime(
		dir: string,
	): Promise<Result<DaemonSkillsRuntimeResult, DaemonFailure>>;
	runSkillsRead(
		dir: string,
		input: RunSkillsReadInput,
	): Promise<Result<DaemonRunSkillsReadResult, DaemonFailure>>;
}
