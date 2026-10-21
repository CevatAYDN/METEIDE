import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { streamCollector } from "../domain/text.js";

// One shell.exec@1 child process (docs/10, Built-in tools): no stdin, both streams kept in
// bounded memory, and the whole process tree killed on timeout or cancellation.

export type ProcessSpec = {
	readonly file: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly timeoutMs: number;
};

export type ProcessResult = {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
};

const WINDOWS = process.platform === "win32";

// child.kill() stops only the shell; its children would keep the output pipes open.
const killTree = (child: ChildProcess) => {
	if (child.pid === undefined) return;
	if (WINDOWS) {
		const taskkill = join(
			process.env.SystemRoot ?? "C:\\Windows",
			"System32",
			"taskkill.exe",
		);
		spawn(taskkill, ["/pid", String(child.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL"); // the group: detached made the shell its leader
	} catch {
		// already gone
	}
};

const collect = (stream: NodeJS.ReadableStream | null) => {
	const c = streamCollector();
	stream?.setEncoding("utf8");
	stream?.on("data", (d: string) => c.push(d));
	return c;
};

/** Kills the tree at the timeout or on cancel; `release` stops watching. */
const watch = (child: ChildProcess, timeoutMs: number, signal: AbortSignal) => {
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		killTree(child);
	}, timeoutMs);
	const cancel = () => killTree(child);
	signal.addEventListener("abort", cancel, { once: true });
	return {
		timedOut: () => timedOut,
		release: () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", cancel);
		},
	};
};

/** Runs one process; a cancelled signal kills it and fails with `io`. */
export const runProcess = (
	spec: ProcessSpec,
	signal: AbortSignal,
): Promise<Result<ProcessResult, ToolError>> =>
	new Promise((done) => {
		if (signal.aborted)
			return done(err({ code: "io", message: "cancelled before start" }));
		const child = spawn(spec.file, [...spec.args], {
			cwd: spec.cwd,
			env: spec.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: !WINDOWS,
			windowsHide: true,
		});
		const stdout = collect(child.stdout);
		const stderr = collect(child.stderr);
		const watched = watch(child, spec.timeoutMs, signal);
		const finish = (r: Result<ProcessResult, ToolError>) => {
			watched.release();
			done(r);
		};
		child.on("error", (e) =>
			finish(err({ code: "io", message: `${spec.file}: ${e.message}` })),
		);
		child.on("close", (code) => {
			if (signal.aborted)
				return finish(err({ code: "io", message: "cancelled" }));
			const timedOut = watched.timedOut();
			const [out, errText] = [stdout.text(), stderr.text()];
			finish(
				ok({
					exitCode: timedOut ? null : code,
					stdout: out,
					stderr: errText,
					timedOut,
				}),
			);
		});
	});
