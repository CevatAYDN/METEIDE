import {
	err,
	type Result,
	type TaskControlAnswer,
	TaskControlAnswerSchema,
	type TaskPending,
	TaskPendingResultSchema,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type {
	DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";

/** Authoritative task controls; failed or loading reads never enable legacy grants. */
export type TaskControlState = {
	readonly phase: "idle" | "loading" | "ready" | "failed";
	readonly requests: readonly TaskPending[];
	readonly busy: readonly string[];
	readonly errors: Readonly<Record<string, string | undefined>>;
	readonly failure: DaemonFailure | undefined;
};
type Deps = {
	readonly fetch: MeteDaemonService["taskPending"];
	readonly send: MeteDaemonService["taskAnswer"];
	readonly changed: () => void;
};
type Run = { readonly dir: string; readonly runId: string };
const runKey = (run: Run) => JSON.stringify([run.dir, run.runId]);
const empty = (): TaskControlState => ({
	phase: "idle",
	requests: [],
	busy: [],
	errors: {},
	failure: undefined,
});
const key = (
	dir: string,
	r: Pick<TaskPending, "runId" | "taskId" | "requestId">,
) => JSON.stringify([dir, r.runId, r.taskId, r.requestId]);
const safe = async <T>(
	call: () => Promise<Result<T, DaemonFailure>>,
): Promise<Result<T, DaemonFailure>> => {
	try {
		return await call();
	} catch (e) {
		return err({ code: "protocol", detail: String(e) });
	}
};

/** Named public session type; lifecycle state and request locks remain private. */
export class TaskControlSession {
	private shown: Run | undefined;
	private version = 0;
	private value = empty();
	private readonly sent = new Map<string, "busy" | "done">();
	private readonly ended = new Set<string>();
	constructor(private readonly deps: Deps) {}

	get state(): TaskControlState {
		const dir = this.shown?.dir ?? "";
		const requests = this.value.requests.filter(
			(r) => this.sent.get(key(dir, r)) !== "done",
		);
		const busy = requests
			.filter((r) => this.sent.get(key(dir, r)) === "busy")
			.map((r) => r.requestId);
		return { ...this.value, requests, busy };
	}
	private set(value: TaskControlState) {
		this.value = value;
		this.deps.changed();
	}
	show(dir: string, runId: string) {
		this.shown = { dir, runId };
		this.set(empty());
		return this.refresh();
	}
	clear() {
		this.shown = undefined;
		this.version++;
		this.set(empty());
	}
	async refresh(): Promise<void> {
		const run = this.shown;
		if (!run || this.ended.has(runKey(run))) return;
		const version = ++this.version;
		this.set({ ...this.value, phase: "loading", failure: undefined });
		const result = await safe(() => this.deps.fetch(run.dir, run.runId));
		if (this.shown !== run || version !== this.version) return;
		if (!result.ok) {
			this.set({ ...this.value, phase: "failed", failure: result.error });
			return;
		}
		const parsed = TaskPendingResultSchema.safeParse(result.value);
		const requests = parsed.success ? parsed.data.requests : undefined;
		if (
			!requests ||
			requests.some((r) => r.runId !== run.runId) ||
			new Set(requests.map((r) => r.requestId)).size !== requests.length
		) {
			this.set({
				...this.value,
				phase: "failed",
				failure: {
					code: "protocol",
					detail: nls.localize(
						"mete/tasks/invalid",
						"Task decisions could not be verified. Refresh to try again.",
					),
				},
			});
			return;
		}
		this.set({ ...this.value, phase: "ready", requests, failure: undefined });
	}
	async answer(input: TaskControlAnswer): Promise<void> {
		const run = this.shown;
		const parsed = TaskControlAnswerSchema.safeParse(input);
		if (!run || !parsed.success || this.value.phase !== "ready") return;
		const answer = parsed.data;
		const id = key(run.dir, answer);
		if (
			!this.state.requests.some((r) => key(run.dir, r) === id) ||
			this.sent.has(id)
		)
			return;
		this.sent.set(id, "busy");
		this.set({
			...this.value,
			errors: { ...this.value.errors, [answer.requestId]: undefined },
		});
		const result = await safe(() => this.deps.send(run.dir, answer));
		if (result.ok) this.sent.set(id, "done");
		else this.sent.delete(id);
		this.deps.changed();
		if (this.shown !== run) return;
		if (!result.ok) {
			this.set({
				...this.value,
				errors: {
					...this.value.errors,
					[answer.requestId]: result.error.detail,
				},
			});
			return;
		}
		await this.refresh();
	}
	onEvent(
		dir: string,
		event: { readonly runId?: string | undefined; readonly type: string },
	) {
		const run = this.shown;
		if (!run || run.dir !== dir || run.runId !== event.runId) return;
		if (["run.cancelled", "run.completed", "run.failed"].includes(event.type)) {
			this.ended.add(runKey(run));
			this.version++;
			// A new selection identity invalidates both fetches and answers already in flight.
			this.shown = { ...run };
			this.set(empty());
			return;
		}
		if (event.type === "run.resumed") {
			this.ended.delete(runKey(run));
			void this.show(dir, run.runId);
			return;
		}
		if (event.type === "task.waiting" || event.type === "task.wait.resolved")
			void this.refresh();
	}
}

/** Keeps request identities and in-flight locks independent of the currently displayed run. */
export const createTaskControlSession = (deps: Deps): TaskControlSession =>
	new TaskControlSession(deps);
