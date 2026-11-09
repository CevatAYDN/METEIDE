import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { MeteDaemonService } from "../domain/status-service.js";
import {
	createTaskControlSession,
	type TaskControlSession,
} from "./task-control-session.js";
import { TaskControlView } from "./task-control-view.js";
import {
	createVerificationSession,
	type VerificationSession,
} from "./verification-session.js";
import { VerificationView } from "./verification-view.js";

type Selection = { readonly dir: string; readonly runId: string };

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

const panels = (
	session: TaskControlSession,
	verification: VerificationSession,
	shown: () => object | undefined,
) => {
	const captured = shown();
	const current = () => captured && shown() === captured;
	return {
		taskControls: (
			<TaskControlView
				state={session.state}
				onAnswer={(input) =>
					current() ? session.answer(input) : Promise.resolve()
				}
				onRefresh={() => {
					if (current()) void session.refresh();
				}}
			/>
		),
		verification: (
			<VerificationView
				state={verification.state}
				onRefresh={() => {
					if (current()) void verification.refresh();
				}}
			/>
		),
	};
};

const bindEvidence = (
	verification: VerificationSession,
	shown: () => Selection | undefined,
	isTeam: () => boolean,
) => {
	let active: Selection | undefined;
	const clear = () => {
		active = undefined;
		verification.clear();
	};
	return {
		clear,
		sync() {
			const current = shown();
			if (!current || !isTeam()) {
				if (active) clear();
				return;
			}
			if (active === current) return;
			active = current;
			void verification.show(current.dir, current.runId);
		},
	};
};

/** Binds task decisions and read-only evidence to the same exact displayed selection. */
export const createTaskControlPanel = (
	daemon: () => Pick<
		MeteDaemonService,
		"taskPending" | "taskAnswer" | "verification"
	>,
	shown: () => Selection | undefined,
	changed: () => void,
	isTeam: () => boolean,
) => {
	const session = createTaskControlSession({
		fetch: (dir, runId) => daemon().taskPending(dir, runId),
		send: (dir, input) => daemon().taskAnswer(dir, input),
		changed,
	});
	const verification = createVerificationSession({
		fetch: (dir, runId) => daemon().verification(dir, runId),
		changed,
	});
	const evidence = bindEvidence(verification, shown, isTeam);
	return {
		show(dir: string, runId: string) {
			void session.show(dir, runId);
			evidence.clear();
		},
		clear() {
			session.clear();
			evidence.clear();
		},
		sync() {
			evidence.sync();
			changed();
		},
		onEvent(dir: string, event: Parameters<typeof session.onEvent>[1]) {
			session.onEvent(dir, event);
			verification.onEvent(dir, event);
		},
		controls: () => panels(session, verification, shown),
	};
};
