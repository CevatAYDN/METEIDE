import type { MeteEvent, RunView } from "@mete/contracts";

// What `mete run` and `mete status` print (ARCHITECTURE.md, CLI). Pure.

const model = (m: { providerId: string; modelId: string }) =>
	`${m.providerId}/${m.modelId}`;

const runLine = (e: MeteEvent): string | undefined => {
	switch (e.type) {
		case "run.started":
			return `run ${e.runId ?? ""} started`;
		case "run.paused": {
			const until = e.payload.resumesAt ? ` until ${e.payload.resumesAt}` : "";
			return `paused: ${e.payload.reason}${until}`;
		}
		case "run.resumed":
			return "resumed";
		case "run.completed":
			return `completed\n${e.payload.summary}`;
		case "run.failed":
			return `failed: ${e.payload.code} ${e.payload.message}`.trimEnd();
		case "run.cancelled":
			return "cancelled";
		default:
			return undefined;
	}
};

const agentLine = (e: MeteEvent): string | undefined => {
	switch (e.type) {
		case "agent.created":
			return `model ${model(e.payload)}`;
		case "agent.model.changed":
			return `model ${model(e.payload.from)} -> ${model(e.payload.to)} (${e.payload.reason})`;
		case "agent.tool.called":
			return `tool  ${e.payload.capability}`;
		case "agent.tool.completed": {
			const ms = Math.round(e.payload.durationMs);
			return `      ${e.payload.ok ? "ok" : "failed"} in ${ms} ms`;
		}
		case "checkpoint.created":
			return `checkpoint ${e.payload.ref}`;
		default:
			return undefined;
	}
};

/** One terminal line for an event of the run, or undefined for events it does not show. */
export const eventLine = (e: MeteEvent) => runLine(e) ?? agentLine(e);

/** The exit code of `mete run` for the state the run ended in. */
export const exitCode = (status: RunView["status"]) =>
	status === "completed" ? 0 : status === "paused" ? 2 : 1;

/** `mete status` as aligned text lines, newest run first. */
export const statusLines = (runs: readonly RunView[]) =>
	runs.length === 0
		? ["no runs"]
		: runs.map((r) => {
				const state = r.pauseReason
					? `${r.status}(${r.pauseReason})`
					: r.status;
				return `${r.id}  ${state.padEnd(16)}  ${r.goal}`;
			});
