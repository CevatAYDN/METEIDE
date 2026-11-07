import { nls } from "@theia/core/lib/common/nls";
import { ContextPreview } from "./context-attachments-view.js";
import { Button } from "./runs-list.js";
import { type SentContextState, sentContextEntries } from "./sent-context.js";

/** Stored snapshots are immutable per turn, with an explicit failed-read recovery action. */
export const SentContext = (props: {
	state: SentContextState;
	onRetry: () => void;
}) => {
	if (props.state.phase === "idle") return null;
	if (props.state.phase === "loading")
		return (
			<p role="status">
				{nls.localize("mete/context/reading", "Reading sent attachments...")}
			</p>
		);
	if (props.state.phase === "failed")
		return (
			<div>
				<p role="alert">
					{nls.localize(
						"mete/context/readFailed",
						"Could not read this turn's attachments. Retry the read.",
					)}
				</p>
				<Button
					label={nls.localize("mete/thread/retry", "Retry")}
					icon="refresh"
					quiet
					onClick={props.onRetry}
				/>
			</div>
		);
	const result = props.state.result;
	if (!result?.attachments.length) return null;
	return (
		<details className="mete-chat-details">
			<summary>
				{nls.localize("mete/context/sent", "Sent attachments for this turn")}
			</summary>
			{sentContextEntries(result).map(({ key, snapshot }) => (
				<ContextPreview key={key} snapshot={snapshot} />
			))}
		</details>
	);
};
