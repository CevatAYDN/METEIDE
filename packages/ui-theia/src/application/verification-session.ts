import {
	err,
	type Result,
	type TaskVerificationResult,
	TaskVerificationResultSchema,
} from "@mete/contracts";
import type {
	DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";

/** A failed/loading refresh may retain evidence, but never labels it current. */
export type VerificationState = {
	readonly phase: "idle" | "loading" | "ready" | "failed";
	readonly result: TaskVerificationResult | undefined;
	readonly failure: DaemonFailure | undefined;
};
type Deps = {
	readonly fetch: MeteDaemonService["verification"];
	readonly changed: () => void;
};
type Run = { readonly dir: string; readonly runId: string };
// Selection, revision and recovery can change the snapshot without evaluating another gate.
const EVIDENCE_WAKEUPS = new Set([
	"verify.updated",
	"verify.evaluated",
	"task.created",
	"task.assigned",
	"task.status.changed",
	"task.attempt.chosen",
	"task.waiting",
	"task.wait.resolved",
	"run.started",
	"run.resumed",
	"run.paused",
	"run.completed",
	"run.failed",
	"run.cancelled",
]);
const empty = (): VerificationState => ({
	phase: "idle",
	result: undefined,
	failure: undefined,
});
const read = async (
	deps: Deps,
	run: Run,
): Promise<Result<TaskVerificationResult, DaemonFailure>> => {
	try {
		const result = await deps.fetch(run.dir, run.runId);
		if (!result.ok) return result;
		const parsed = TaskVerificationResultSchema.safeParse(result.value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: err({ code: "protocol", detail: parsed.error.message });
	} catch (e) {
		return err({ code: "protocol", detail: String(e) });
	}
};

/** Read-only evidence owned by the exact displayed selection and refresh generation. */
export class VerificationSession {
	private shown: Run | undefined;
	private generation = 0;
	private value = empty();
	constructor(private readonly deps: Deps) {}

	get state(): VerificationState {
		return this.value;
	}
	private set(value: VerificationState) {
		this.value = value;
		this.deps.changed();
	}
	show(dir: string, runId: string): Promise<void> {
		this.shown = { dir, runId };
		this.set(empty());
		return this.refresh();
	}
	clear(): void {
		this.shown = undefined;
		this.generation++;
		this.set(empty());
	}
	async refresh(): Promise<void> {
		const run = this.shown;
		if (!run) return;
		const generation = ++this.generation;
		this.set({ ...this.value, phase: "loading", failure: undefined });
		const result = await read(this.deps, run);
		if (this.shown !== run || this.generation !== generation) return;
		this.set(
			result.ok
				? { phase: "ready", result: result.value, failure: undefined }
				: { ...this.value, phase: "failed", failure: result.error },
		);
	}
	onEvent(
		dir: string,
		event: { readonly runId?: string | undefined; readonly type: string },
	): void {
		const run = this.shown;
		if (!run || run.dir !== dir || run.runId !== event.runId) return;
		if (event.type === "run.removed") {
			this.clear();
			return;
		}
		if (EVIDENCE_WAKEUPS.has(event.type)) void this.refresh();
	}
}

/** Creates a session without timers, replay inference or mutation paths. */
export const createVerificationSession = (deps: Deps): VerificationSession =>
	new VerificationSession(deps);
