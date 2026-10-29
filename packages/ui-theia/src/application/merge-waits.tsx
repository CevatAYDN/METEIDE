import type { TaskCard } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import { Card } from "./wait-card.js";

// The Waiting for you card of an approved task whose merge did not land (ADR-156): git's cause, the
// files in the way, and the approve that tries the merge again (docs/08); there is nothing to revise.

// The files sit in JetBrains Mono, so the sentence is split around their placeholder.
const Instruction = ({
	paths,
}: {
	readonly paths?: readonly string[] | undefined;
}) => {
	if (!paths?.length)
		return (
			<p className="mete-wait-note">
				{nls.localize(
					"mete/waiting/mergeCommitAll",
					"Commit or move your own uncommitted changes in this folder, then try the merge again.",
				)}
			</p>
		);
	const text = nls.localize(
		"mete/waiting/mergeCommit",
		"Commit or move your own changes to {0}, then try the merge again.",
		"{0}",
	);
	const [before, after] = text.split("{0}");
	return (
		<p className="mete-wait-note">
			{before}
			<span className="mete-mono">{paths.join(", ")}</span>
			{after}
		</p>
	);
};

/** The card of a task whose merge failed; its one button approves the task, which tries the merge again. */
export const NotMerged = ({
	task,
	onApprove,
}: {
	readonly task: TaskCard;
	readonly onApprove: () => void;
}) => (
	<Card
		tone="bad"
		icon="git-merge"
		title={nls.localize(
			"mete/waiting/notMerged",
			"“{0}” did not merge",
			task.title,
		)}
		kind={{
			icon: "git-merge",
			word: nls.localize("mete/board/notMerged", "Not merged"),
		}}
	>
		<p className="mete-wait-note">{task.merge?.message}</p>
		<Instruction paths={task.merge?.paths} />
		<div className="mete-wait-actions">
			<button type="button" className="mete-button" onClick={onApprove}>
				<Icon name="git-merge" />
				{nls.localize("mete/waiting/mergeAgain", "Try the merge again")}
			</button>
		</div>
	</Card>
);
