import type { ConversationThread } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import { Button } from "./runs-list.js";
import {
	failureText,
	noFolderText,
	statusTone,
	statusWord,
} from "./status-text.js";
import type { ThreadListState } from "./thread-list.js";
import { shortWhen } from "./time-text.js";

type Props = {
	readonly state: ThreadListState;
	readonly onSearch: (query: string) => void;
	readonly onMore: () => void;
	readonly onRetry: () => void;
	readonly onOpen: (runId: string) => void;
	readonly onStart: () => void;
	readonly shown?: string | undefined;
};

const Row = ({
	row,
	onOpen,
	shown,
}: {
	readonly row: ConversationThread;
	readonly onOpen: Props["onOpen"];
	readonly shown: Props["shown"];
}) => (
	<li
		className="mete-item"
		aria-current={row.head.id === shown ? "true" : undefined}
	>
		<span
			className={`mete-tile ${statusTone(row.head.status)}`}
			aria-hidden="true"
		>
			<Icon name="comment-discussion" />
		</span>
		<span className="mete-side-body">
			<button
				type="button"
				className="mete-link mete-clamp"
				title={row.title}
				onClick={() => onOpen(row.head.id)}
			>
				{row.title}
			</button>
			<span className="mete-sub">
				<span className={`mete-chip ${statusTone(row.head.status)}`}>
					{statusWord(row.head.status)}
				</span>
				{" · "}
				{shortWhen(row.updatedAt)}
			</span>
		</span>
	</li>
);

const Notices = ({ state, onRetry }: Pick<Props, "state" | "onRetry">) => (
	<>
		{state.kind === "no_folder" ? (
			<p className="mete-note">{noFolderText()}</p>
		) : null}
		{state.failure ? (
			<>
				<p role="alert">{failureText(state.failure)}</p>
				<Button
					label={nls.localize("mete/thread/retry", "Retry")}
					icon="refresh"
					onClick={onRetry}
					quiet
				/>
			</>
		) : null}
		{state.kind === "loading" ? (
			<p role="status">
				{nls.localize("mete/thread/loading", "Reading conversations…")}
			</p>
		) : null}
		{state.kind === "ready" && state.rows.length === 0 ? (
			<p className="mete-note">
				{nls.localize(
					"mete/thread/none",
					"No conversations match this search.",
				)}
			</p>
		) : null}
	</>
);

/** One metadata row per conversation; team runs remain in their original section (ADR-182). */
export const ConversationsSection = (props: Props) => {
	const { state } = props;
	const search = nls.localize("mete/thread/search", "Search conversations");
	return (
		<section
			className="mete-side-section"
			aria-label={nls.localize("mete/thread/conversations", "Conversations")}
		>
			<div className="mete-side-actions">
				<Button
					label={nls.localize("mete/home/newRun", "New run")}
					icon="add"
					onClick={props.onStart}
				/>
			</div>
			<input
				type="search"
				className="mete-field"
				aria-label={search}
				placeholder={search}
				value={state.query}
				onChange={(event) => props.onSearch(event.target.value)}
				disabled={state.kind === "no_folder"}
			/>
			<Notices state={state} onRetry={props.onRetry} />
			<ul className="mete-side-cards">
				{state.rows.map((row) => (
					<Row
						key={row.id}
						row={row}
						onOpen={props.onOpen}
						shown={props.shown}
					/>
				))}
			</ul>
			{state.cursor ? (
				<button
					type="button"
					className="mete-button quiet"
					disabled={state.kind !== "ready"}
					onClick={props.onMore}
				>
					<Icon name="chevron-down" />
					{nls.localize("mete/thread/more", "Load more")}
				</button>
			) : null}
		</section>
	);
};
