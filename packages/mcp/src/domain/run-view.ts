import type { MeteEvent } from "@mete/contracts";

// What mete_task_status tells about a run beyond its RunView, read from the run's events (docs/10).

type TaskStatus = Extract<
	MeteEvent,
	{ type: "task.status.changed" }
>["payload"]["to"];

/** A run's tasks, the paths of its artifacts, its summary once completed and why it failed. */
export type RunProgress = {
	readonly tasks: { id: string; title: string; status: TaskStatus }[];
	readonly artifacts: string[];
	readonly output?: string;
	readonly failure?: string;
};

type Fold = {
	tasks: Map<string, RunProgress["tasks"][number]>;
	artifacts: Map<string, string>;
	output?: string;
	failure?: string;
};

const step = (f: Fold, e: MeteEvent) => {
	switch (e.type) {
		case "task.created":
			if (e.taskId)
				f.tasks.set(e.taskId, {
					id: e.taskId,
					title: e.payload.title,
					status: "todo",
				});
			return;
		case "task.status.changed": {
			const task = e.taskId ? f.tasks.get(e.taskId) : undefined;
			if (task) task.status = e.payload.to;
			return;
		}
		case "artifact.created":
		case "artifact.updated":
			f.artifacts.set(e.payload.artifactId, e.payload.path);
			return;
		case "run.completed":
			f.output = e.payload.summary;
			return;
		case "run.failed":
			f.failure = `${e.payload.code}: ${e.payload.message}`;
	}
};

/** Folds a run's events, oldest first, into its progress; an artifact counts once, at its last path. */
export const runProgress = (events: readonly MeteEvent[]): RunProgress => {
	const f: Fold = { tasks: new Map(), artifacts: new Map() };
	for (const e of events) step(f, e);
	const { output, failure } = f;
	return {
		tasks: [...f.tasks.values()],
		artifacts: [...f.artifacts.values()],
		...(output === undefined ? {} : { output }),
		...(failure === undefined ? {} : { failure }),
	};
};
