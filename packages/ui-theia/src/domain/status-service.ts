import type {
	ApprovalInput,
	AuditEntry,
	DaemonStatusResultSchema,
	MeteEvent,
	ProviderState,
	QuotaUnitUsage,
	Result,
	RunStart,
} from "@mete/contracts";

import type { ProviderKey } from "./provider-keys.js";

// What the Theia frontend asks its backend, which owns the daemon process (ARCHITECTURE.md, Daemon protocol).

/** Where the backend serves the daemon service on Theia's connection. */
export const METE_DAEMON_PATH = "/services/mete-daemon";

/** The runs `mete/status` answers, as the daemon protocol schema parses them. */
export type StatusRuns = ReturnType<typeof DaemonStatusResultSchema.parse>;

/**
 * Why a status call has no runs: the daemon is not ready (`detail` is what core-engine waits for,
 * ADR-046), it stopped (`detail` is its exit code and last stderr lines), the restart limit is
 * reached, the router wants a template chosen, the daemon refused the request, its answer did
 * not parse, or a `mete` command the backend ran ended badly.
 */
export type DaemonFailure = {
	readonly code:
		| "not_ready"
		| "choose_template"
		| "stopped"
		| "blocked"
		| "refused"
		| "protocol"
		| "cli";
	readonly detail: string;
	/** With choose_template: the templates the router suggests for the goal (ADR-047). */
	readonly suggestions?: readonly string[];
};

/** The filters of mete/audit (ADR-053); each one is optional. */
export type AuditFilter = {
	readonly runId?: string;
	readonly verdict?: AuditEntry["verdict"];
	readonly action?: AuditEntry["action"];
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
	/** Starts a run in the folder; its events reach the frontend through MeteDaemonClient. */
	startRun(
		workspaceDir: string,
		req: RunStart,
	): Promise<Result<{ readonly runId: string }, DaemonFailure>>;
	/** The human's decision on a run paused for approval; the engine judges whether it applies. */
	approve(
		workspaceDir: string,
		runId: string,
		input: ApprovalInput,
	): Promise<Result<null, DaemonFailure>>;
	/** The providers `mete key list` names, with whether each has a key (ADR-049). */
	keys(): Promise<Result<ProviderKey[], DaemonFailure>>;
	/** Saves a provider key through `mete key set` and restarts the daemon, which then reads it. */
	setKey(providerId: string, key: string): Promise<Result<null, DaemonFailure>>;
	/** Goes on with a paused run. */
	resume(
		workspaceDir: string,
		runId: string,
	): Promise<Result<null, DaemonFailure>>;
	/** A run's persisted events in order, and how many rows no longer parse (ADR-051). */
	events(
		workspaceDir: string,
		runId: string,
	): Promise<
		Result<
			{ readonly events: readonly MeteEvent[]; readonly unreadable: number },
			DaemonFailure
		>
	>;
	/** The workspace audit log, newest first, filtered by run, verdict and action (ADR-053). */
	audit(
		workspaceDir: string,
		filter: AuditFilter,
	): Promise<
		Result<{ readonly entries: readonly AuditEntry[] }, DaemonFailure>
	>;
	/** Whether each provider can carry a run on now (ADR-050), and the pool's units (ADR-054). */
	quota(workspaceDir: string): Promise<
		Result<
			{
				readonly providers: readonly ProviderState[];
				readonly units: readonly QuotaUnitUsage[];
			},
			DaemonFailure
		>
	>;
}
