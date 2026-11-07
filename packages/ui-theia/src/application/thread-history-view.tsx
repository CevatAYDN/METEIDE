import type { ThreadReadResult } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { hasEnded } from "../domain/home-model.js";
import { Icon } from "./roster-look.js";
import { Button } from "./runs-list.js";
import { failureText, statusWord } from "./status-text.js";
import type { ThreadHistoryState } from "./thread-history.js";

type Props = {
	readonly state: ThreadHistoryState;
	readonly selected: string;
	readonly onOpen: (runId: string, goal: string) => void;
	readonly onRetry: () => void;
	readonly onRemove?: ((runId: string) => void) | undefined;
};

const Turns = (props: Props & { readonly result: ThreadReadResult }) => (
	<ol className="mete-thread-turns">
		{props.result.turns.map((run, index) => (
			<li key={run.id}>
				<button
					type="button"
					className="mete-link"
					aria-label={nls.localize(
						"mete/thread/turn",
						"Turn {0} of {1}: {2}",
						index + 1,
						props.result.turns.length,
						run.goal,
					)}
					aria-current={run.id === props.selected ? "true" : undefined}
					onClick={() => props.onOpen(run.id, props.result.conversation.title)}
				>
					<Icon name="history" /> {run.goal}
					{" · "}
					{statusWord(run.status)}
				</button>
				{props.onRemove && hasEnded(run) ? (
					<button
						type="button"
						className="mete-button quiet icon"
						aria-label={nls.localize(
							"mete/thread/removeRun",
							"Remove run {0}: {1}",
							index + 1,
							run.goal,
						)}
						title={nls.localize(
							"mete/thread/removeRun",
							"Remove run {0}: {1}",
							index + 1,
							run.goal,
						)}
						onClick={() => props.onRemove?.(run.id)}
					>
						<Icon name="trash" />
					</button>
				) : null}
			</li>
		))}
	</ol>
);

/** Each retained run opens its existing details; replying requires returning to the current head. */
export const ThreadHistory = (props: Props) => {
	const { state } = props;
	if (state.phase === "idle") return null;
	if (state.phase === "loading")
		return (
			<p role="status">
				{nls.localize("mete/thread/historyLoading", "Reading run history…")}
			</p>
		);
	if (state.failure)
		return (
			<div>
				<p role="alert">{failureText(state.failure)}</p>
				<Button
					label={nls.localize("mete/thread/retry", "Retry")}
					icon="refresh"
					onClick={props.onRetry}
					quiet
				/>
			</div>
		);
	const result = state.result;
	if (!result) return null;
	const { head, title } = result.conversation;
	const older = props.selected !== head.id;
	return (
		<div className="mete-thread-history">
			{older ? (
				<Button
					label={nls.localize("mete/thread/latest", "Return to latest")}
					icon="arrow-right"
					onClick={() => props.onOpen(head.id, title)}
					quiet
				/>
			) : null}
			<details className="mete-chat-details">
				<summary>{nls.localize("mete/thread/history", "Run history")}</summary>
				<Turns {...props} result={result} />
			</details>
		</div>
	);
};
