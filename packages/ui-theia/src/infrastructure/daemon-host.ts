import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	type AllowScope,
	type ApprovalInput,
	DAEMON_METHODS,
	DaemonAuditResultSchema,
	DaemonChainResultSchema,
	DaemonChangesResultSchema,
	DaemonCheckpointRestoreResultSchema,
	DaemonDoneResultSchema,
	DaemonErrorDataSchema,
	DaemonEstimateResultSchema,
	DaemonEventsResultSchema,
	DaemonKnowledgeSearchResultSchema,
	DaemonMemberDraftResultSchema,
	DaemonModelsResultSchema,
	DaemonQuotaResultSchema,
	DaemonRunStartResultSchema,
	DaemonStatusResultSchema,
	DaemonStopAllResultSchema,
	DaemonTemplateReadResultSchema,
	DaemonTemplatesResultSchema,
	err,
	type MeteEvent,
	type ModelRef,
	ok,
	parseEvent,
	type Result,
	type RunPrefer,
	type RunReplyInput,
	RunReplyOutputSchema,
	type RunStart,
	type Tier,
	TranscriptSchema,
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
import { conversationRequests } from "./conversation-requests.js";
import { mcpConnectionRequests } from "./mcp-connection-requests.js";
import {
	type Parsed,
	type Send,
	settingsRequests,
} from "./settings-requests.js";
import { taskControlRequests } from "./task-control-requests.js";
import { threadContextRequests } from "./thread-context-requests.js";

// Owns one folder's daemon. Served processes recover automatically; startup failures retry on demand.

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

// ADR-046: refusals retain readiness reasons or messages; malformed error data is a protocol fault.
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

// Closing stdin releases the run lock; an intentional restart does not count as a crash.
const askToStop = (live: Live | undefined) => {
	if (!live || live.ended) return live;
	live.stopping = true;
	live.child.stdin.end();
	return live;
};

/** The one daemon the host keeps. */
type Slot = { live?: Live };

// Only same-folder crashes spend restart budget; await the old process before taking its run lock.
const ensure = async (
	deps: HostDeps,
	slot: Slot,
	dir: string,
): Promise<Result<Live, DaemonFailure>> => {
	const before = slot.live;
	if (before && !before.ended && before.dir === dir) return ok(before);
	if (before && !before.ended) {
		await askToStop(before)?.closed;
		// A call that waited alongside may have started the next daemon already.
		if (slot.live !== before) return ensure(deps, slot, dir);
	}
	const crashed = before?.dir === dir && before.ended && !before.stopping;
	if (before && crashed && !deps.policy.allow(deps.now()))
		return err({ code: "blocked", detail: detailOf(before) });
	slot.live = launch(deps, dir, (live) => {
		if (slot.live === live) void ensure(deps, slot, dir);
	});
	return ok(slot.live);
};

const reads = (send: Send) => ({
	status: (dir: string, runId?: string) =>
		send(
			dir,
			DAEMON_METHODS.status,
			runId === undefined ? {} : { runId },
			(raw) => DaemonStatusResultSchema.safeParse(raw),
		),
	events: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.events, { runId }, (raw) =>
			DaemonEventsResultSchema.safeParse(raw),
		),
	transcript: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.runTranscript, { runId }, (raw) =>
			TranscriptSchema.safeParse(raw),
		),
	audit: (dir: string, filter: object) =>
		send(dir, DAEMON_METHODS.audit, filter, (raw) =>
			DaemonAuditResultSchema.safeParse(raw),
		),
	knowledgeSearch: (dir: string, query: string) =>
		send(dir, DAEMON_METHODS.knowledgeSearch, { query }, (raw) =>
			DaemonKnowledgeSearchResultSchema.safeParse(raw),
		),
	changes: (dir: string, path?: string) =>
		send(
			dir,
			DAEMON_METHODS.changes,
			path === undefined ? {} : { path },
			(raw) => DaemonChangesResultSchema.safeParse(raw),
		),
	quota: (dir: string) =>
		send(dir, DAEMON_METHODS.quota, {}, (raw) =>
			DaemonQuotaResultSchema.safeParse(raw),
		),
});

/** One member drafted from the user's idea, for the team editor (ADR-108). */
const draftRead = (send: Send) => ({
	memberDraft: (
		dir: string,
		idea: string,
		language: "en" | "tr",
		teamGoal?: string,
	) =>
		send(
			dir,
			DAEMON_METHODS.memberDraft,
			{ idea, language, ...(teamGoal === undefined ? {} : { teamGoal }) },
			(raw) => DaemonMemberDraftResultSchema.safeParse(raw),
		),
});

// Templates, estimates and model facts for composing runs and teams.
const composing = (send: Send) => ({
	templates: (dir: string) =>
		send(dir, DAEMON_METHODS.templates, {}, (raw) =>
			DaemonTemplatesResultSchema.safeParse(raw),
		),
	estimate: (dir: string, templateId: string | null, prefer?: RunPrefer) =>
		send(dir, DAEMON_METHODS.estimate, { templateId, prefer }, (raw) =>
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
	models: (dir: string, models: readonly ModelRef[]) =>
		send(dir, DAEMON_METHODS.models, { models }, (raw) =>
			DaemonModelsResultSchema.safeParse(raw),
		),
	checkpointRestore: (dir: string, runId: string, checkpointId: string) =>
		send(
			dir,
			DAEMON_METHODS.checkpointRestore,
			{ runId, checkpointId },
			(raw) => DaemonCheckpointRestoreResultSchema.safeParse(raw),
		),
});

// Runs in flight: start (ADR-047), human decisions (ADR-048, ADR-121) and model steering (ADR-122).
const steering = (
	send: Send,
	done: (raw: unknown) => ReturnType<typeof DaemonDoneResultSchema.safeParse>,
) => ({
	/** Starts a run in the folder (ADR-047); its events arrive through onEvent. */
	startRun: (dir: string, req: RunStart) =>
		send(dir, DAEMON_METHODS.runStart, req, (raw) =>
			DaemonRunStartResultSchema.safeParse(raw),
		),
	replyRun: (dir: string, req: RunReplyInput) =>
		send(dir, DAEMON_METHODS.runReply, req, (raw) =>
			RunReplyOutputSchema.safeParse(raw),
		),
	/** The human's decision on a paused run (ADR-048). */
	approve: (dir: string, runId: string, input: ApprovalInput) =>
		send(dir, DAEMON_METHODS.runApprove, { runId, input }, done),
	resume: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.runResume, { runId }, done),
	/** Deletes an ended run (ADR-143); run.removed follows through onEvent. */
	remove: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.runRemove, { runId }, done),
	/** Grants a policy ask and resumes (ADR-121). */
	allow: (dir: string, runId: string, scope: AllowScope) =>
		send(dir, DAEMON_METHODS.runAllow, { runId, scope }, done),
	/** Sets or clears a run-specific model preference (null clears) (ADR-122). */
	model: (
		dir: string,
		runId: string,
		model: ModelRef | null,
		roleId?: string,
	) =>
		send(
			dir,
			DAEMON_METHODS.runModel,
			{ runId, model, ...(roleId === undefined ? {} : { roleId }) },
			done,
		),
});

const cancellable = (slot: Slot) => (dir: string) =>
	slot.live?.dir === dir && !slot.live.ended && !slot.live.stopping;

/** Serves the daemon's requests for one folder at a time; another folder replaces the daemon. */
export const createDaemonHost = (deps: HostDeps) => {
	const slot: Slot = {};
	// One request to the folder's daemon, started first when it is not running.
	const send: Send = async (dir, method, params, parse) => {
		const daemon = await ensure(deps, slot, dir);
		return daemon.ok ? call(daemon.value, method, params, parse) : daemon;
	};
	const done = (raw: unknown) => DaemonDoneResultSchema.safeParse(raw);
	return {
		...reads(send),
		...draftRead(send),
		...composing(send),
		...settingsRequests(send),
		...mcpConnectionRequests(send, cancellable(slot)),
		...conversationRequests(send),
		...threadContextRequests(send),
		...taskControlRequests(send),
		...steering(send, done),
		/** Cancels every run of the folder that has not ended (ADR-065). */
		stopAll: (dir: string) =>
			send(dir, DAEMON_METHODS.stopAll, {}, (raw) =>
				DaemonStopAllResultSchema.safeParse(raw),
			),
		stop: () => void askToStop(slot.live),
		restartIdle: async (dir: string): Promise<Result<null, DaemonFailure>> => {
			const live = slot.live;
			if (!live || live.dir !== dir || live.ended || live.stopping)
				return err({
					code: "stopped",
					detail:
						"The workspace daemon changed; refresh before applying settings",
				});
			const ready = await call(live, DAEMON_METHODS.quiesce, {}, done);
			if (!ready.ok) return ready;
			if (slot.live !== live)
				return err({
					code: "stopped",
					detail: "The workspace changed during restart",
				});
			await askToStop(live)?.closed;
			return ok(null);
		},
		/** Stops the daemon and waits until it has ended; the next call starts it again, uncounted (ADR-049). */
		restart: async () => {
			await askToStop(slot.live)?.closed;
		},
	};
};
