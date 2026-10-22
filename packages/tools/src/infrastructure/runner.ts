import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "@mete/contracts";
import { z } from "zod";
import { BROWSER_TIMEOUT_MS, RUNNER_STDERR_CHARS } from "../defaults.js";

// The main process side of the browser runner: one child per call, killed on timeout or abort,
// its stderr tail in the error so a failure says what went wrong (docs/10, Built-in tools).

/** One job for the runner; `out` is the absolute path of the file it writes. */
export type RunnerRequest =
	| {
			readonly kind: "screenshot";
			readonly url: string;
			readonly fullPage: boolean;
			readonly out: string;
	  }
	| { readonly kind: "audit"; readonly url: string; readonly out: string };

const ReplySchema = z.union([
	z.object({ ok: z.literal(true) }),
	z.object({ ok: z.literal(false), message: z.string() }),
]);
export type RunnerReply = z.output<typeof ReplySchema>;

/** Runs one job; the tests pass a fake. */
export type RunBrowser = (
	req: RunnerRequest,
	signal: AbortSignal,
) => Promise<Result<void, string>>;

const RUNNER = fileURLToPath(new URL("./browser-runner.js", import.meta.url));

/** Runs each job in a forked child process of its own. */
export const forkRunner: RunBrowser = (req, signal) =>
	new Promise((resolve) => {
		const child = fork(RUNNER, [], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		});
		let tail = "";
		child.stderr?.on("data", (c: Buffer) => {
			tail = (tail + c.toString()).slice(-RUNNER_STDERR_CHARS);
		});
		const timer = setTimeout(
			() => done(err(`the browser took longer than ${BROWSER_TIMEOUT_MS} ms`)),
			BROWSER_TIMEOUT_MS,
		);
		const onAbort = () => done(err("cancelled"));
		const done = (r: Result<void, string>) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			child.removeAllListeners();
			child.kill();
			resolve(r);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		child.on("message", (m) => {
			const reply = ReplySchema.safeParse(m);
			if (!reply.success)
				done(err("the browser runner sent an unreadable answer"));
			else done(reply.data.ok ? ok(undefined) : err(reply.data.message));
		});
		child.on("error", (e) => done(err(e.message)));
		child.on("exit", (code) =>
			done(
				err(
					`the browser runner exited with ${code}${tail ? `; stderr: ${tail.trim()}` : ""}`,
				),
			),
		);
		child.send(req);
	});
