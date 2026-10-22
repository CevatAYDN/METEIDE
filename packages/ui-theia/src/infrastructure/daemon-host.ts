import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	DAEMON_METHODS,
	DaemonStatusResultSchema,
	err,
	ok,
	type Result,
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
import type { DaemonFailure, StatusRuns } from "../domain/status-service.js";

// Owns the `mete daemon` child of one folder: starts it on the first call, talks protocol version 1
// to it and starts it again after a crash, within the restart policy (ARCHITECTURE.md, Failure handling).
// shortcut: a crashed daemon starts again on the next call, not at once; eager restarts come with
// the first panel that streams events.

/** Starts `mete daemon` for a folder. */
export type SpawnDaemon = (
	workspaceDir: string,
) => ChildProcessWithoutNullStreams;

/** What the host needs from outside; tests pass a fake daemon and a clock. */
export type HostDeps = {
	readonly spawn: SpawnDaemon;
	readonly policy: RestartPolicy;
	readonly now: () => number;
};

type Live = {
	readonly dir: string;
	readonly child: ChildProcessWithoutNullStreams;
	readonly conn: MessageConnection;
	/** The last stderr lines: they say why a daemon stopped (no provider key, the run lock is held). */
	readonly tail: string[];
	exitCode?: number | null;
	ended: boolean;
	stopping: boolean;
};

const keepTail = (tail: string[], chunk: Buffer | string) => {
	for (const line of String(chunk).split(/\r?\n/))
		if (line.trim()) tail.push(line.trim());
	tail.splice(0, Math.max(0, tail.length - STDERR_TAIL_LINES));
};

const launch = (spawn: SpawnDaemon, dir: string): Live => {
	const child = spawn(dir);
	const conn = createMessageConnection(
		new StreamMessageReader(child.stdout),
		new StreamMessageWriter(child.stdin),
	);
	const live: Live = {
		dir,
		child,
		conn,
		tail: [],
		ended: false,
		stopping: false,
	};
	// Disposing the connection rejects the requests that wait for an answer.
	const end = () => {
		if (live.ended) return;
		live.ended = true;
		conn.dispose();
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
	conn.listen();
	return live;
};

const detailOf = (live: Live) => {
	const code = live.exitCode === undefined ? "" : `exit code ${live.exitCode}`;
	return [code, live.tail.join(" ")].filter(Boolean).join(": ");
};

const ask = async (
	live: Live,
	runId: string | undefined,
): Promise<Result<StatusRuns, DaemonFailure>> => {
	try {
		const params = runId === undefined ? {} : { runId };
		const raw: unknown = await live.conn.sendRequest(
			DAEMON_METHODS.status,
			params,
		);
		const runs = DaemonStatusResultSchema.safeParse(raw);
		if (runs.success) return ok(runs.data);
		return err({ code: "protocol", detail: runs.error.message });
	} catch (e) {
		// Disposing the connection rejects a waiting request with a ResponseError too, so a daemon
		// that ended counts first.
		if (!live.ended && e instanceof ResponseError)
			return err({ code: "refused", detail: e.message });
		return err({ code: "stopped", detail: detailOf(live) });
	}
};

/** Serves `mete/status` for one folder at a time; another folder replaces the daemon. */
export const createDaemonHost = (deps: HostDeps) => {
	let live: Live | undefined;
	// A start after a daemon that ended on its own, in the same folder, is a restart; a first start
	// and a start for another folder are free.
	const ensure = (dir: string): Result<Live, DaemonFailure> => {
		if (live && !live.ended && live.dir === dir) return ok(live);
		const before = live;
		if (before && !before.ended) {
			before.stopping = true;
			before.child.stdin.end();
		}
		const crashed = before?.dir === dir && before.ended && !before.stopping;
		if (before && crashed && !deps.policy.allow(deps.now()))
			return err({ code: "blocked", detail: detailOf(before) });
		live = launch(deps.spawn, dir);
		return ok(live);
	};
	return {
		status: async (dir: string, runId?: string) => {
			const daemon = ensure(dir);
			return daemon.ok ? ask(daemon.value, runId) : daemon;
		},
		/** Closing its input is how a daemon is asked to stop; it releases the run lock itself. */
		stop: () => {
			if (!live || live.ended) return;
			live.stopping = true;
			live.child.stdin.end();
		},
	};
};
