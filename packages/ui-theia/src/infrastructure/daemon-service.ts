import type { ApprovalInput, RunStart } from "@mete/contracts";
import { ILogger } from "@theia/core/lib/common/logger";
import type { BackendApplicationContribution } from "@theia/core/lib/node";
import { inject, injectable } from "@theia/core/shared/inversify";
import { DAEMON_MAX_RESTARTS, DAEMON_RESTART_WINDOW_MS } from "../defaults.js";
import { createRestartPolicy } from "../domain/restart-policy.js";
import type {
	MeteDaemonClient,
	MeteDaemonService,
} from "../domain/status-service.js";
import { createDaemonHost } from "./daemon-host.js";
import { spawnCli } from "./spawn-cli.js";

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

	startRun(workspaceDir: string, req: RunStart) {
		return this.host.startRun(workspaceDir, req);
	}

	approve(workspaceDir: string, runId: string, input: ApprovalInput) {
		return this.host.approve(workspaceDir, runId, input);
	}

	resume(workspaceDir: string, runId: string) {
		return this.host.resume(workspaceDir, runId);
	}

	onStop() {
		this.host.stop();
	}
}
