import { DAEMON_METHODS, DaemonRunIdParamsSchema } from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { type Io, withEngine } from "./commands.js";
import { terminalConfirm } from "./confirm.js";
import { parsed, readyEngine, refused } from "./daemon-errors.js";

// Remove a run (ADR-143): the engine deletes an ended run with its worktrees, branches, checkpoints
// and rows, and storage and the gateway delete their rows on run.removed. Nothing undoes it, so the
// terminal asks first; the desktop asks in its own dialog before it sends mete/run.remove.

export const serveRemove = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.runRemove, async (params: unknown) => {
		const p = parsed(DaemonRunIdParamsSchema.safeParse(params ?? {}));
		const engine = readyEngine(app);
		if (!engine.remove)
			throw refused({
				code: "not_supported",
				message: "removing runs is not supported",
			});
		const r = await engine.remove(p.runId);
		if (!r.ok) throw refused(r.error);
		return null;
	});

/** `mete remove <run id>`: removes an ended run after the user's yes. */
export const removeCommand = (app: App, io: Io, runId: string) =>
	withEngine(app, io, async (engine) => {
		if (!engine.remove) {
			io.err("removing runs is not supported");
			return 1;
		}
		const question = `Remove run ${runId} with its worktrees, branches, checkpoints, events and model calls? Nothing undoes it`;
		const never = new AbortController().signal;
		const yes = await terminalConfirm(io)("mete", question, never);
		if (!yes) {
			io.err("nothing removed");
			return 1;
		}
		const r = await engine.remove(runId);
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		io.out(`${runId} removed`);
		return 0;
	});
