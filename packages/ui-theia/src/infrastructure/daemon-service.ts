import type { BackendApplicationContribution } from "@theia/core/lib/node";
import { injectable } from "@theia/core/shared/inversify";
import { DAEMON_MAX_RESTARTS, DAEMON_RESTART_WINDOW_MS } from "../defaults.js";
import { createRestartPolicy } from "../domain/restart-policy.js";
import type { MeteDaemonService } from "../domain/status-service.js";
import { createDaemonHost } from "./daemon-host.js";
import { spawnCli } from "./spawn-cli.js";

/** The backend's side of the METE panels: owns the daemon and stops it with the backend. */
@injectable()
export class MeteDaemonBackend
	implements MeteDaemonService, BackendApplicationContribution
{
	protected readonly host = createDaemonHost({
		spawn: spawnCli,
		policy: createRestartPolicy(DAEMON_MAX_RESTARTS, DAEMON_RESTART_WINDOW_MS),
		now: Date.now,
	});

	status(workspaceDir: string, runId?: string) {
		return this.host.status(workspaceDir, runId);
	}

	onStop() {
		this.host.stop();
	}
}
