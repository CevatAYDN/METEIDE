import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
} from "node:child_process";
import { join } from "node:path";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { KILL_GRACE_MS } from "../defaults.js";
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

const system32 = (...path: string[]) =>
	join(process.env.SystemRoot ?? "C:\\Windows", "System32", ...path);

// child.kill() stops only the shell; its children would keep the output pipes open.
const killTree = (child: ChildProcess) => {
	if (child.pid === undefined) return;
	if (WINDOWS) {
		spawn(system32("taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"], {
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

// taskkill /T kills the tree it sees at that moment, so a child the shell starts during the kill, or
// one still running after the shell exited, escapes it and keeps the output pipes open. Windows keeps
// a process's parent id after the parent ends: this kills the shell's children by it, only those
// created before the shell exited, so a later process that reuses the shell's id is left alone.
const sweepOrphans = (pid: number, exitedAt: number) =>
	new Promise<void>((resolve) => {
		const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Where-Object { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() -le ${exitedAt} } | ForEach-Object { taskkill.exe /pid $_.ProcessId /T /F }`;
		const ps = system32("WindowsPowerShell", "v1.0", "powershell.exe");
		const args = ["-NoProfile", "-NonInteractive", "-Command", script];
		const p = spawn(ps, args, { stdio: "ignore", windowsHide: true });
		p.on("close", () => resolve());
		p.on("error", () => resolve());
	});

// After a kill the call must end (docs/10, shell.exec@1): once the shell has exited, output still
// open after the grace time means a straggler holds it; it is swept, then the pipes are closed.
const settle = (child: ChildProcess, ended: () => boolean) => {
	const close = async (exitedAt: number) => {
		if (ended()) return;
		if (WINDOWS && child.pid !== undefined)
			await sweepOrphans(child.pid, exitedAt);
		if (ended()) return;
		child.stdout?.destroy();
		child.stderr?.destroy();
	};
	const after = (exitedAt: number) =>
		setTimeout(() => void close(exitedAt), KILL_GRACE_MS);
	if (child.exitCode !== null || child.signalCode !== null) after(Date.now());
	else child.once("exit", () => after(Date.now()));
};

/** Kills the tree at the timeout or on cancel, and sees that the output closes; `release` stops watching. */
const watch = (child: ChildProcess, timeoutMs: number, signal: AbortSignal) => {
	let timedOut = false;
	let ended = false;
	const kill = () => {
		killTree(child);
		settle(child, () => ended);
	};
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, timeoutMs);
	signal.addEventListener("abort", kill, { once: true });
	return {
		timedOut: () => timedOut,
		release: () => {
			ended = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", kill);
		},
	};
};

/** Starts a child with no stdin and piped output; arguments the process API refuses (a NUL byte) are bad_input. */
export const spawnPiped = (
	file: string,
	args: readonly string[],
	options: Omit<SpawnOptions, "stdio">,
) => {
	try {
		const stdio = ["ignore", "pipe", "pipe"] as const;
		return ok(spawn(file, [...args], { ...options, stdio: [...stdio] }));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return err<ToolError>({
			code: "bad_input",
			message: `${file}: ${message}`,
		});
	}
};

/** Runs one process; a cancelled signal kills it and fails with `io`. */
export const runProcess = (
	spec: ProcessSpec,
	signal: AbortSignal,
): Promise<Result<ProcessResult, ToolError>> =>
	new Promise((done) => {
		if (signal.aborted)
			return done(err({ code: "io", message: "cancelled before start" }));
		const started = spawnPiped(spec.file, spec.args, {
			cwd: spec.cwd,
			env: spec.env,
			detached: !WINDOWS,
			windowsHide: true,
		});
		if (!started.ok) return done(started);
		const child = started.value;
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
