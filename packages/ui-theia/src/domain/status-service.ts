import type {
	DaemonStatusResultSchema,
	MeteEvent,
	Result,
} from "@mete/contracts";

// What the Theia frontend asks its backend, which owns the daemon process (ARCHITECTURE.md, Daemon protocol).

/** Where the backend serves the daemon service on Theia's connection. */
export const METE_DAEMON_PATH = "/services/mete-daemon";

/** The runs `mete/status` answers, as the daemon protocol schema parses them. */
export type StatusRuns = ReturnType<typeof DaemonStatusResultSchema.parse>;

/**
 * Why a status call has no runs: the daemon is not ready (`detail` is what core-engine waits for,
 * ADR-046), it stopped (`detail` is its exit code and last stderr lines), the restart limit is
 * reached, the daemon refused the request, or its answer did not parse.
 */
export type DaemonFailure = {
	readonly code: "not_ready" | "stopped" | "blocked" | "refused" | "protocol";
	readonly detail: string;
};

/** What the backend calls on each frontend: an event the daemon of a folder published. */
export interface MeteDaemonClient {
	onEvent(workspaceDir: string, event: MeteEvent): void;
}

/** The backend side of the METE panels; the first call for a folder starts its daemon. */
export const MeteDaemonService = Symbol("MeteDaemonService");
export interface MeteDaemonService {
	status(
		workspaceDir: string,
		runId?: string,
	): Promise<Result<StatusRuns, DaemonFailure>>;
}
