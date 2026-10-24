import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	type ApprovalInput,
	DAEMON_METHODS,
	DaemonAuditResultSchema,
	DaemonChainResultSchema,
	DaemonCheckpointRestoreResultSchema,
	DaemonDoneResultSchema,
	DaemonErrorDataSchema,
	DaemonEstimateResultSchema,
	DaemonEventsResultSchema,
	DaemonProviderModelsResultSchema,
	DaemonProviderTestResultSchema,
	DaemonQuotaResultSchema,
	DaemonRunStartResultSchema,
	DaemonSettingsResultSchema,
	DaemonStatusResultSchema,
	DaemonStopAllResultSchema,
	DaemonTemplateReadResultSchema,
	DaemonTemplatesResultSchema,
	err,
	type MeteEvent,
	ok,
	parseEvent,
	type Result,
	type RunStart,
	type Tier,
} from "@mete/contracts";
import {
	createMessageConnection,
	type MessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { STDERR_TAIL_LINES } from "../defaults.js";
import type { RestartPolicy } from "../domain/restart-policy.js";
import type { DaemonFailure, Need } from "../domain/status-service.js";

// Owns the `mete daemon` child of one folder: starts it on the first call, talks the daemon protocol
// to it and starts it again after a crash, within the restart policy (ARCHITECTURE.md, Failure handling).
// A daemon that had answered starts again at once, so the runs it held resume from their snapshots; one
// that ended before it answered (a held run lock, an invalid configuration) would fail the same way, so
// it starts again on the next call, after the user could fix the cause.

/** Starts `mete daemon` for a folder. */
export type SpawnDaemon = (
	workspaceDir: string,
) => ChildProcessWithoutNullStreams;

/** What the host needs from outside; tests pass a fake daemon and a clock. */
export type HostDeps = {
	readonly spawn: SpawnDaemon;
	readonly policy: RestartPolicy;
	readonly now: () => number;
	/** A `mete/event` of the folder's daemon, checked against the event catalog. */
	readonly onEvent: (workspaceDir: string, event: MeteEvent) => void;
	/** A notification that is not a catalog event: a protocol fault the backend logs. */
	readonly onBadEvent: (workspaceDir: string, why: string) => void;
};

type Live = {
	readonly dir: string;
	readonly child: ChildProcessWithoutNullStreams;
	readonly conn: MessageConnection;
	/** The last stderr lines: they say why a daemon stopped (the run lock is held, an invalid configuration). */
	readonly tail: string[];
	exitCode?: number | null;
	ended: boolean;
	stopping: boolean;
	/** It has answered a request, so a crash is not a failure to start. */
	served: boolean;
	/** Settles once the process has ended. */
	closed: Promise<void>;
};

const keepTail = (tail: string[], chunk: Buffer | string) => {
	for (const line of String(chunk).split(/\r?\n/))
		if (line.trim()) tail.push(line.trim());
	tail.splice(0, Math.max(0, tail.length - STDERR_TAIL_LINES));
};

const launch = (
	deps: HostDeps,
	dir: string,
	onCrash: (live: Live) => void,
): Live => {
	const child = deps.spawn(dir);
	const conn = createMessageConnection(
		new StreamMessageReader(child.stdout),
		new StreamMessageWriter(child.stdin),
	);
	let settle = () => {};
	const live: Live = {
		dir,
		child,
		conn,
		tail: [],
		ended: false,
		stopping: false,
		served: false,
		closed: new Promise<void>((resolve) => {
			settle = resolve;
		}),
	};
	// Disposing the connection rejects the requests that wait for an answer.
	const end = () => {
		if (live.ended) return;
		live.ended = true;
		conn.dispose();
		settle();
		if (live.served && !live.stopping) onCrash(live);
	};
	child.stderr.on("data", (chunk: Buffer | string) =>
		keepTail(live.tail, chunk),
	);
	child.on("error", (e) => {
		live.tail.push(e.message);
		end();
	});
	child.on("close", (code) => {
		live.exitCode = code;
		end();
	});
	conn.onNotification(DAEMON_METHODS.event, (raw: unknown) => {
		const e = parseEvent(raw);
		if (e.ok) deps.onEvent(dir, e.value);
		else deps.onBadEvent(dir, e.error.issues.join("; "));
	});
	conn.listen();
	return live;
};

const detailOf = (live: Live) => {
	const code = live.exitCode === undefined ? "" : `exit code ${live.exitCode}`;
	return [code, live.tail.join(" ")].filter(Boolean).join(": ");
};

// A refusal carries its reason in data (ADR-046): not_ready lists what core-engine waits for. An
// error without data, such as invalid params, keeps its message; data that does not parse is a
// protocol fault.
const refusal = (e: ResponseError<unknown>): Result<never, DaemonFailure> => {
	if (e.data === undefined) return err({ code: "refused", detail: e.message });
	const data = DaemonErrorDataSchema.safeParse(e.data);
	if (!data.success) return err({ code: "protocol", detail: e.message });
	if (data.data.code === "choose_template")
		return err({
			code: "choose_template",
			detail: e.message,
			suggestions: data.data.suggestions,
		});
	if (data.data.code !== "not_ready")
		return err({ code: "refused", detail: e.message });
	const reasons = data.data.reasons.map((r) => r.replace(/\.$/, ""));
	return err({ code: "not_ready", detail: reasons.join("; ") });
};

type Parsed<T> =
	| { readonly success: true; readonly data: T }
	| { readonly success: false; readonly error: { readonly message: string } };

// One request to the daemon; its answer is parsed with the protocol schema (each side validates).
const call = async <T>(
	live: Live,
	method: string,
	params: object,
	parse: (raw: unknown) => Parsed<T>,
): Promise<Result<T, DaemonFailure>> => {
	try {
		const answer = parse(await live.conn.sendRequest(method, params));
		live.served = true;
		if (answer.success) return ok(answer.data);
		return err({ code: "protocol", detail: answer.error.message });
	} catch (e) {
		// Disposing the connection rejects a waiting request with a ResponseError too, so a daemon
		// that ended counts first.
		if (!live.ended && e instanceof ResponseError) {
			live.served = true;
			return refusal(e);
		}
		return err({ code: "stopped", detail: detailOf(live) });
	}
};

// Closing its input is how a daemon is asked to stop; it releases the run lock itself, and a
// start after a stop that was asked for is not a restart the policy counts.
const askToStop = (live: Live | undefined) => {
	if (!live || live.ended) return live;
	live.stopping = true;
	live.child.stdin.end();
	return live;
};

/** The one daemon the host keeps. */
type Slot = { live?: Live };

// A start after a daemon that ended on its own, in the same folder, is a restart; a first start
// and a start for another folder are free.
const ensure = (
	deps: HostDeps,
	slot: Slot,
	dir: string,
): Result<Live, DaemonFailure> => {
	const before = slot.live;
	if (before && !before.ended && before.dir === dir) return ok(before);
	if (before && !before.ended) {
		before.stopping = true;
		before.child.stdin.end();
	}
	const crashed = before?.dir === dir && before.ended && !before.stopping;
	if (before && crashed && !deps.policy.allow(deps.now()))
		return err({ code: "blocked", detail: detailOf(before) });
	slot.live = launch(deps, dir, (live) => {
		if (slot.live === live) ensure(deps, slot, dir);
	});
	return ok(slot.live);
};

type Send = <T>(
	dir: string,
	method: string,
	params: object,
	parse: (raw: unknown) => Parsed<T>,
) => Promise<Result<T, DaemonFailure>>;

// The requests that only read: the runs, one run's events (ADR-051), the providers' states (ADR-050)
// and the audit log (ADR-053).
const reads = (send: Send) => ({
	status: (dir: string, runId?: string) =>
		send(
			dir,
			DAEMON_METHODS.status,
			runId === undefined ? {} : { runId },
			(raw) => DaemonStatusResultSchema.safeParse(raw),
		),
	/** A run's persisted events and how many rows no longer parse (ADR-051). */
	events: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.events, { runId }, (raw) =>
			DaemonEventsResultSchema.safeParse(raw),
		),
	/** The workspace audit log, filtered (ADR-053). */
	audit: (dir: string, filter: object) =>
		send(dir, DAEMON_METHODS.audit, filter, (raw) =>
			DaemonAuditResultSchema.safeParse(raw),
		),
	/** Each provider's state (ADR-050). */
	quota: (dir: string) =>
		send(dir, DAEMON_METHODS.quota, {}, (raw) =>
			DaemonQuotaResultSchema.safeParse(raw),
		),
});

// What the run composer asks before Start: the team templates (ADR-058) and each one's request
// estimate (ADR-068); and the text of one template and a tier's models for the team editor
// (ADR-075, ADR-077); and Settings: what was loaded, and a custom endpoint's models and Test (ADR-087).
const composing = (send: Send) => ({
	templates: (dir: string) =>
		send(dir, DAEMON_METHODS.templates, {}, (raw) =>
			DaemonTemplatesResultSchema.safeParse(raw),
		),
	estimate: (dir: string, templateId: string | null) =>
		send(dir, DAEMON_METHODS.estimate, { templateId }, (raw) =>
			DaemonEstimateResultSchema.safeParse(raw),
		),
	readTemplate: (dir: string, id: string) =>
		send(dir, DAEMON_METHODS.templateRead, { id }, (raw) =>
			DaemonTemplateReadResultSchema.safeParse(raw),
		),
	chain: (dir: string, tier: Tier, needs: readonly Need[]) =>
		send(dir, DAEMON_METHODS.chain, { tier, needs }, (raw) =>
			DaemonChainResultSchema.safeParse(raw),
		),
	settings: (dir: string) =>
		send(dir, DAEMON_METHODS.settings, {}, (raw) =>
			DaemonSettingsResultSchema.safeParse(raw),
		),
	providerModels: (dir: string, providerId: string) =>
		send(dir, DAEMON_METHODS.providerModels, { providerId }, (raw) =>
			DaemonProviderModelsResultSchema.safeParse(raw),
		),
	providerTest: (dir: string, providerId: string, models: readonly string[]) =>
		send(dir, DAEMON_METHODS.providerTest, { providerId, models }, (raw) =>
			DaemonProviderTestResultSchema.safeParse(raw),
		),
	checkpointRestore: (dir: string, runId: string, checkpointId: string) =>
		send(
			dir,
			DAEMON_METHODS.checkpointRestore,
			{ runId, checkpointId },
			(raw) => DaemonCheckpointRestoreResultSchema.safeParse(raw),
		),
});

/** Serves the daemon's requests for one folder at a time; another folder replaces the daemon. */
export const createDaemonHost = (deps: HostDeps) => {
	const slot: Slot = {};
	// One request to the folder's daemon, started first when it is not running.
	const send: Send = async (dir, method, params, parse) => {
		const daemon = ensure(deps, slot, dir);
		return daemon.ok ? call(daemon.value, method, params, parse) : daemon;
	};
	const done = (raw: unknown) => DaemonDoneResultSchema.safeParse(raw);
	return {
		...reads(send),
		...composing(send),
		/** Starts a run in the folder (ADR-047); its events arrive through onEvent. */
		startRun: (dir: string, req: RunStart) =>
			send(dir, DAEMON_METHODS.runStart, req, (raw) =>
				DaemonRunStartResultSchema.safeParse(raw),
			),
		/** The human's decision on a paused run (ADR-048). */
		approve: (dir: string, runId: string, input: ApprovalInput) =>
			send(dir, DAEMON_METHODS.runApprove, { runId, input }, done),
		resume: (dir: string, runId: string) =>
			send(dir, DAEMON_METHODS.runResume, { runId }, done),
		/** Cancels every run of the folder that has not ended (ADR-065). */
		stopAll: (dir: string) =>
			send(dir, DAEMON_METHODS.stopAll, {}, (raw) =>
				DaemonStopAllResultSchema.safeParse(raw),
			),
		stop: () => void askToStop(slot.live),
		/** Stops the daemon and waits until it has ended; the next call starts it again, uncounted (ADR-049). */
		restart: async () => {
			await askToStop(slot.live)?.closed;
		},
	};
};
