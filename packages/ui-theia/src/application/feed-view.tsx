import type { MeteEvent } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { roleWords } from "../domain/roster.js";
import { type Feed, type FeedLine, feedLine, inFeed } from "./feed-rows.js";
import { MUTED, ROW } from "./look.js";
import { MarkdownView } from "./markdown-view.js";
import { Icon, LINE } from "./roster-look.js";
import { toneStyle } from "./tone.js";

// The Team view's Activity feed (ADR-092), newest first: segments filter it, Follow off keeps the
// rows it shows, and a row opens to its event's payload. The rows hang on a thread of tiles (ADR-127),
// laid out by style/mete-run.css.

const SEGMENTS = ["all", "asks", "work", "run"] as const;

const segmentName = (s: Segment) =>
	({
		all: nls.localize("mete/feed/all", "All"),
		asks: nls.localize("mete/feed/asksSegment", "Asks"),
		work: nls.localize("mete/feed/work", "Work"),
		run: nls.localize("mete/feed/run", "Run"),
	})[s];

type Names = Readonly<Record<string, string>>;

const nameOf = (names: Names, role: string) =>
	role === "human"
		? nls.localize("mete/feed/you", "You")
		: (names[role] ?? roleWords(role));

// The day too for an event of another day, such as a checkpoint saved after the run ended.
const clock = (ts: string) => {
	const at = new Date(ts);
	const day =
		at.toDateString() === new Date().toDateString()
			? {}
			: ({ day: "numeric", month: "short" } as const);
	return at.toLocaleString([], {
		...day,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
};

// The thread's tile: the initial of who acted, or the event's icon for the run's own events. It is
// decorative: the row's words name who did what.
const Tile = ({
	line,
	names,
}: {
	readonly line: FeedLine;
	readonly names: Names;
}) => (
	<span className="mete-feed-tile" aria-hidden="true">
		{line.who ? (
			nameOf(names, line.who).charAt(0).toUpperCase()
		) : (
			<Icon name={line.icon} />
		)}
	</span>
);

// A row on the thread; an ask or a failure wears its tone's wash (ADR-127).
const Row = ({
	event,
	line,
	names,
	markdown,
}: {
	readonly event: Feed;
	readonly line: FeedLine;
	readonly names: Names;
	readonly markdown: MarkdownRenderer;
}) => (
	<li
		className="mete-feed-row"
		style={toneStyle(line.tone ?? "muted")}
		{...(line.tone === "warn" || line.tone === "bad"
			? { "data-alert": "" }
			: {})}
	>
		<details>
			<summary>
				<Tile line={line} names={names} />
				<span className="mete-feed-text">
					<span style={LINE}>
						{line.who ? <strong>{nameOf(names, line.who)}</strong> : null}
						{line.to ? (
							<>
								<span style={MUTED}>→</span>
								<strong>{nameOf(names, line.to)}</strong>
							</>
						) : null}
						<span>{line.text}</span>
					</span>
					{line.quote ? (
						// A task's questions and a human's feedback keep their lines.
						<q
							style={{ ...MUTED, fontStyle: "italic", whiteSpace: "pre-line" }}
						>
							{line.quote}
						</q>
					) : null}
					{line.detail ? (
						<MarkdownView text={line.detail} renderer={markdown} />
					) : null}
				</span>
				<time dateTime={event.ts} className="mete-mono">
					{clock(event.ts)}
				</time>
			</summary>
			<pre className="mete-feed-peek">
				{JSON.stringify(event.payload, null, 2)}
			</pre>
		</details>
	</li>
);

/** A feed segment, or all of them. */
export type Segment = (typeof SEGMENTS)[number];

// Follow off holds the id of the newest event shown then ("" for an empty feed); the feed keeps its
// latest events only, so a held event it dropped shows them all.
const shownOf = (feed: readonly MeteEvent[], held: string | undefined) => {
	const at = feed.findIndex((e) => e.id === held);
	return held === undefined || (at < 0 && held !== "")
		? feed
		: feed.slice(0, at + 1);
};

/** The rows the feed shows, newest first, and how many newer events Follow off holds back. */
export const feedRows = (
	view: TeamView,
	feed: readonly MeteEvent[],
	segment: Segment,
	held?: string,
) => {
	const shown = shownOf(feed, held);
	const rows = shown
		.filter(inFeed)
		.map((event) => ({ event, line: feedLine(view, event) }))
		.filter((r) => segment === "all" || r.line.segment === segment)
		.reverse();
	return { rows, waiting: feed.length - shown.length };
};

const Header = ({
	segment,
	onSegment,
	follow,
	onFollow,
}: {
	readonly segment: Segment;
	readonly onSegment: (s: Segment) => void;
	readonly follow: boolean;
	readonly onFollow: () => void;
}) => (
	<>
		<div className="mete-feed-controls">
			<fieldset
				className="mete-segmented small"
				aria-label={nls.localize("mete/feed/show", "Show")}
			>
				{SEGMENTS.map((s) => (
					<button
						key={s}
						type="button"
						aria-pressed={s === segment}
						onClick={() => onSegment(s)}
					>
						{segmentName(s)}
					</button>
				))}
			</fieldset>
			<button
				type="button"
				role="switch"
				className="mete-follow"
				aria-checked={follow}
				onClick={onFollow}
			>
				<Icon name="pin" />
				{nls.localize("mete/feed/follow", "Follow")}
				<span className="mete-knob" aria-hidden="true" />
			</button>
		</div>
		<h3 className="mete-feed-title">
			{nls.localize("mete/feed/title", "Activity · newest first")}
		</h3>
	</>
);

/** The feed of the run the Team view shows. */
export const FeedView = ({
	view,
	feed,
	names,
	markdown,
}: {
	readonly view: TeamView;
	readonly feed: readonly MeteEvent[];
	readonly names: Names;
	readonly markdown: MarkdownRenderer;
}) => {
	const [segment, setSegment] = useState<Segment>("all");
	const [held, setHeld] = useState<string>();
	const { rows, waiting } = feedRows(view, feed, segment, held);
	return (
		<section
			aria-label={nls.localize("mete/feed/name", "Activity")}
			className="mete-feed"
		>
			<Header
				segment={segment}
				onSegment={setSegment}
				follow={held === undefined}
				onFollow={() =>
					setHeld(held === undefined ? (feed.at(-1)?.id ?? "") : undefined)
				}
			/>
			{waiting > 0 ? (
				<button
					type="button"
					className="mete-button"
					onClick={() => setHeld(undefined)}
				>
					{nls.localize("mete/feed/newer", "Show {0} new", waiting)}
				</button>
			) : null}
			{rows.length > 0 ? (
				<ol className="mete-feed-list">
					{rows.map((r) => (
						<Row key={r.event.id} {...r} names={names} markdown={markdown} />
					))}
				</ol>
			) : (
				<Empty segment={segment} onAll={() => setSegment("all")} />
			)}
		</section>
	);
};

const Empty = ({
	segment,
	onAll,
}: {
	readonly segment: Segment;
	readonly onAll: () => void;
}) => (
	<p style={{ ...ROW, ...MUTED }}>
		{nls.localize("mete/feed/empty", "Nothing here yet.")}
		{segment === "all" ? null : (
			<button type="button" className="mete-button quiet" onClick={onAll}>
				{nls.localize("mete/feed/showAll", "Show all")}
			</button>
		)}
	</p>
);
