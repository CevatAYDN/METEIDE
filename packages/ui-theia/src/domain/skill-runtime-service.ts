import type {
	DaemonRunSkillsReadResult,
	DaemonRunSkillsStartParams,
	DaemonSkillsRuntimeResult,
	DaemonThreadSkillsReplyParams,
	DaemonThreadSkillsStartParams,
	Result,
	RunSkillsReadInput,
	ThreadStarted,
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
	threadSkillsStart(
		dir: string,
		input: DaemonThreadSkillsStartParams,
	): Promise<Result<ThreadStarted, DaemonFailure>>;
	threadSkillsReply(
		dir: string,
		input: DaemonThreadSkillsReplyParams,
	): Promise<Result<ThreadStarted, DaemonFailure>>;
	runSkillsStart(
		dir: string,
		input: DaemonRunSkillsStartParams,
	): Promise<Result<{ runId: string }, DaemonFailure>>;
}
