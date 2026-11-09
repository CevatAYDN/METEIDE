import type {
	AllowScope,
	ApprovalInput,
	ContextDraft,
	ConversationReplyInput,
	ConversationStartInput,
	DaemonSkillsApproveParams,
	DaemonSkillsDisableParams,
	DaemonSkillsEditorParams,
	DaemonSkillsPrepareParams,
	McpConnectionRequest,
	McpCredentialWrite,
	McpServer,
	ModelRef,
	RunPrefer,
	RunReplyInput,
	RunSkillsReadInput,
	RunStart,
	TaskControlAnswer,
	ThreadContextReplyInput,
	ThreadContextStartInput,
	ThreadListInput,
	ThreadReadInput,
	ThreadReplyInput,
	ThreadStartInput,
	Tier,
} from "@mete/contracts";
import { ILogger } from "@theia/core/lib/common/logger";
import type { BackendApplicationContribution } from "@theia/core/lib/node";
import { inject, injectable } from "@theia/core/shared/inversify";
import { DAEMON_MAX_RESTARTS, DAEMON_RESTART_WINDOW_MS } from "../defaults.js";
import { createRestartPolicy } from "../domain/restart-policy.js";
import type {
	AuditFilter,
	MeteDaemonClient,
	MeteDaemonService,
	Need,
} from "../domain/status-service.js";
import { createDaemonHost } from "./daemon-host.js";
import { createKeyService } from "./key-service.js";
import { createMcpCredentialService } from "./mcp-credential-service.js";
import { runCli, spawnCli } from "./spawn-cli.js";

/**
 * The backend's side of the METE panels: owns the daemon, forwards its events to every connected
 * frontend and stops it with the backend.
 */
@injectable()
export class MeteDaemonBackend
	implements MeteDaemonService, BackendApplicationContribution
{
	@inject(ILogger) protected readonly logger!: ILogger;

	protected readonly clients = new Set<MeteDaemonClient>();

	protected readonly host = createDaemonHost({
		spawn: spawnCli,
		policy: createRestartPolicy(DAEMON_MAX_RESTARTS, DAEMON_RESTART_WINDOW_MS),
		now: Date.now,
		onEvent: (dir, event) => {
			for (const client of this.clients) client.onEvent(dir, event);
		},
		onBadEvent: (dir, why) =>
			void this.logger.warn(
				`mete daemon of ${dir} sent an event METE does not know: ${why}`,
			),
	});

	protected readonly keyService = createKeyService({
		run: runCli,
		restart: () => this.host.restart(),
	});

	keys() {
		return this.keyService.keys();
	}

	skillsList(dir: string) {
		return this.host.skillsList(dir);
	}
	skillsRuntime(dir: string) {
		return this.host.skillsRuntime(dir);
	}
	runSkillsRead(dir: string, input: RunSkillsReadInput) {
		return this.host.runSkillsRead(dir, input);
	}

	skillsPrepare(dir: string, input: DaemonSkillsPrepareParams) {
		return this.host.skillsPrepare(dir, input);
	}
	skillsEditor(dir: string, input: DaemonSkillsEditorParams) {
		return this.host.skillsEditor(dir, input);
	}

	skillsApprove(dir: string, input: DaemonSkillsApproveParams) {
		return this.host.skillsApprove(dir, input);
	}

	skillsDisable(dir: string, input: DaemonSkillsDisableParams) {
		return this.host.skillsDisable(dir, input);
	}

	skillsRecover(dir: string, sessionId: string) {
		return this.host.skillsRecover(dir, sessionId);
	}

	skillsRecovery(dir: string) {
		return this.host.skillsRecovery(dir);
	}

	setKey(providerId: string, key: string) {
		return this.keyService.setKey(providerId, key);
	}

	mcpConnection(dir: string, input: McpConnectionRequest) {
		return this.host.mcpConnection(dir, input);
	}

	registrySetup(dir: string, name: string) {
		return this.host.registrySetup(dir, name);
	}

	setMcpCredentials(dir: string, input: McpCredentialWrite) {
		return createMcpCredentialService({
			run: runCli,
			restartIdle: (folder) => this.host.restartIdle(folder),
		}).set(dir, input);
	}

	/** A frontend connected; it receives the events of every folder's daemon until it leaves. */
	addClient(client: MeteDaemonClient): void {
		this.clients.add(client);
	}

	removeClient(client: MeteDaemonClient): void {
		this.clients.delete(client);
	}

	status(workspaceDir: string, runId?: string) {
		return this.host.status(workspaceDir, runId);
	}

	taskPending(workspaceDir: string, runId: string) {
		return this.host.taskPending(workspaceDir, runId);
	}

	verification(workspaceDir: string, runId: string) {
		return this.host.verification(workspaceDir, runId);
	}

	taskAnswer(workspaceDir: string, input: TaskControlAnswer) {
		return this.host.taskAnswer(workspaceDir, input);
	}

	startRun(workspaceDir: string, req: RunStart) {
		return this.host.startRun(workspaceDir, req);
	}

	conversationStart(workspaceDir: string, input: ConversationStartInput) {
		return this.host.conversationStart(workspaceDir, input);
	}

	conversationReply(workspaceDir: string, input: ConversationReplyInput) {
		return this.host.conversationReply(workspaceDir, input);
	}

	threadStart(dir: string, input: ThreadStartInput) {
		return this.host.threadStart(dir, input);
	}

	threadContextPrepare(dir: string, input: ContextDraft) {
		return this.host.threadContextPrepare(dir, input);
	}

	threadContextStart(dir: string, input: ThreadContextStartInput) {
		return this.host.threadContextStart(dir, input);
	}

	threadContextReply(dir: string, input: ThreadContextReplyInput) {
		return this.host.threadContextReply(dir, input);
	}

	threadContextRead(dir: string, input: ThreadReadInput) {
		return this.host.threadContextRead(dir, input);
	}

	threadReply(dir: string, input: ThreadReplyInput) {
		return this.host.threadReply(dir, input);
	}

	threadList(dir: string, input: ThreadListInput) {
		return this.host.threadList(dir, input);
	}

	threadRead(dir: string, input: ThreadReadInput) {
		return this.host.threadRead(dir, input);
	}

	replyRun(workspaceDir: string, input: RunReplyInput) {
		return this.host.replyRun(workspaceDir, input);
	}

	approve(workspaceDir: string, runId: string, input: ApprovalInput) {
		return this.host.approve(workspaceDir, runId, input);
	}

	resume(workspaceDir: string, runId: string) {
		return this.host.resume(workspaceDir, runId);
	}

	remove(workspaceDir: string, runId: string) {
		return this.host.remove(workspaceDir, runId);
	}

	allow(workspaceDir: string, runId: string, scope: AllowScope) {
		return this.host.allow(workspaceDir, runId, scope);
	}

	model(
		workspaceDir: string,
		runId: string,
		model: ModelRef | null,
		roleId?: string,
	) {
		return this.host.model(workspaceDir, runId, model, roleId);
	}

	stopAll(workspaceDir: string) {
		return this.host.stopAll(workspaceDir);
	}

	events(workspaceDir: string, runId: string) {
		return this.host.events(workspaceDir, runId);
	}

	transcript(workspaceDir: string, runId: string) {
		return this.host.transcript(workspaceDir, runId);
	}

	audit(workspaceDir: string, filter: AuditFilter) {
		return this.host.audit(workspaceDir, filter);
	}

	knowledgeSearch(workspaceDir: string, query: string) {
		return this.host.knowledgeSearch(workspaceDir, query);
	}

	changes(workspaceDir: string, path?: string) {
		return this.host.changes(workspaceDir, path);
	}

	memberDraft(
		workspaceDir: string,
		idea: string,
		language: "en" | "tr",
		teamGoal?: string,
	) {
		return this.host.memberDraft(workspaceDir, idea, language, teamGoal);
	}

	quota(workspaceDir: string) {
		return this.host.quota(workspaceDir);
	}

	templates(workspaceDir: string) {
		return this.host.templates(workspaceDir);
	}

	estimate(
		workspaceDir: string,
		templateId: string | null,
		prefer?: RunPrefer,
	) {
		return this.host.estimate(workspaceDir, templateId, prefer);
	}

	readTemplate(workspaceDir: string, id: string) {
		return this.host.readTemplate(workspaceDir, id);
	}

	chain(workspaceDir: string, tier: Tier, needs: readonly Need[]) {
		return this.host.chain(workspaceDir, tier, needs);
	}

	models(workspaceDir: string, models: readonly ModelRef[]) {
		return this.host.models(workspaceDir, models);
	}

	restart() {
		return this.host.restart();
	}

	restartIdle(workspaceDir: string) {
		return this.host.restartIdle(workspaceDir);
	}

	settings(workspaceDir: string) {
		return this.host.settings(workspaceDir);
	}

	providerModels(workspaceDir: string, providerId: string) {
		return this.host.providerModels(workspaceDir, providerId);
	}

	providerTest(
		workspaceDir: string,
		providerId: string,
		models: readonly string[],
	) {
		return this.host.providerTest(workspaceDir, providerId, models);
	}

	mcpTest(workspaceDir: string, id: string, expected?: McpServer) {
		return this.host.mcpTest(workspaceDir, id, expected);
	}

	registrySearch(workspaceDir: string, query: string) {
		return this.host.registrySearch(workspaceDir, query);
	}

	registryPrepare(workspaceDir: string, name: string) {
		return this.host.registryPrepare(workspaceDir, name);
	}

	checkpointRestore(workspaceDir: string, runId: string, checkpointId: string) {
		return this.host.checkpointRestore(workspaceDir, runId, checkpointId);
	}

	onStop() {
		this.host.stop();
	}
}
