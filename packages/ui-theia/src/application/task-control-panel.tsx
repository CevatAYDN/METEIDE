import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { MeteDaemonService } from "../domain/status-service.js";
import { createTaskControlSession } from "./task-control-session.js";
import { TaskControlView } from "./task-control-view.js";

/** Missing task-control state never exposes event-derived legacy task actions. */
export const taskControlNotice = (controls: ReactNode) =>
	controls ?? (
		<p role="alert">
			{nls.localize(
				"mete/tasks/unavailable",
				"Task decisions are unavailable. Refresh the run to try again.",
			)}
		</p>
	);

/** Binds each rendered action to the selection that produced it, including its workspace. */
export const createTaskControlPanel = (
	daemon: () => Pick<MeteDaemonService, "taskPending" | "taskAnswer">,
	shown: () => object | undefined,
	changed: () => void,
) => {
	const session = createTaskControlSession({
		fetch: (dir, runId) => daemon().taskPending(dir, runId),
		send: (dir, input) => daemon().taskAnswer(dir, input),
		changed,
	});
	return {
		session,
		render() {
			const captured = shown();
			return (
				<TaskControlView
					state={session.state}
					onAnswer={(input) =>
						captured && shown() === captured
							? session.answer(input)
							: Promise.resolve()
					}
					onRefresh={() => {
						if (captured && shown() === captured) void session.refresh();
					}}
				/>
			);
		},
	};
};
