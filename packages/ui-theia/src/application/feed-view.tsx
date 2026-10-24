import type { MeteEvent } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { type CSSProperties, useState } from "react";
import { roleWords } from "../domain/roster.js";
import { type Feed, type FeedLine, feedLine, inFeed } from "./feed-rows.js";
import { LIST, MUTED, ROW } from "./look.js";
import { Icon, LINE } from "./roster-look.js";
import { TONES } from "./tone.js";

// The Team view's Activity feed (ADR-092), newest first: segments filter it, Follow off keeps the
// rows it shows, and a row opens to its event's payload.

const MONO = "var(--theia-code-font-family, monospace)";

const SEGMENTS = ["all", "asks", "work", "run"] as const;

const segmentName = (s: Segment) =>
	({
		all: nls.localize("mete/feed/all", "All"),
		asks: nls.localize("mete/feed/asksSegment", "Asks"),
		work: nls.localize("mete/feed/work", "Work"),
		run: nls.localize("mete/feed/run", "Run"),
	})[s];

const SUMMARY: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "18px minmax(0, 1fr) auto",
	gap: "8px",
	alignItems: "start",
	cursor: "pointer",
	listStyle: "none",
	padding: "6px 2px",
};

const PEEK: CSSProperties = {
	fontFamily: MONO,
	fontSize: "0.9em",
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
	margin: "0 0 6px 26px",
	...MUTED,
};

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

const Row = ({
	event,
	line,
	names,
}: {
	readonly event: Feed;
	readonly line: FeedLine;
	readonly names: Names;
}) => (
	<li
		style={{ borderBottom: "1px solid var(--line, var(--theia-panel-border))" }}
	>
		<details>
			<summary style={SUMMARY}>
				<span style={{ color: TONES[line.tone ?? "muted"] }}>
					<Icon name={line.icon} />
				</span>
				<span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
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
						<q style={{ ...MUTED, fontStyle: "italic" }}>{line.quote}</q>
					) : null}
				</span>
				<time dateTime={event.ts} style={{ ...MUTED, fontFamily: MONO }}>
					{clock(event.ts)}
				</time>
			</summary>
			<pre style={PEEK}>{JSON.stringify(event.payload, null, 2)}</pre>
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
	<div style={{ ...ROW, justifyContent: "space-between" }}>
		<strong style={LINE}>
			<Icon name="pulse" />
			{nls.localize("mete/feed/title", "Activity · newest first")}
		</strong>
		<div style={ROW}>
			<fieldset
				aria-label={nls.localize("mete/feed/show", "Show")}
				style={{
					display: "flex",
					gap: "4px",
					border: "none",
					margin: 0,
					padding: 0,
				}}
			>
				{SEGMENTS.map((s) => (
					<button
						key={s}
						type="button"
						className={s === segment ? "mete-button" : "mete-button quiet"}
						aria-pressed={s === segment}
						onClick={() => onSegment(s)}
					>
						{segmentName(s)}
					</button>
				))}
			</fieldset>
			<button
				type="button"
				className="mete-button quiet"
				aria-pressed={follow}
				onClick={onFollow}
			>
				<Icon name={follow ? "pinned" : "pin"} />{" "}
				{nls.localize("mete/feed/follow", "Follow")}
			</button>
		</div>
	</div>
);

/** The feed of the run the Team view shows. */
export const FeedView = ({
	view,
	feed,
	names,
}: {
	readonly view: TeamView;
	readonly feed: readonly MeteEvent[];
	readonly names: Names;
}) => {
	const [segment, setSegment] = useState<Segment>("all");
	const [held, setHeld] = useState<string>();
	const { rows, waiting } = feedRows(view, feed, segment, held);
	return (
		<section
			aria-label={nls.localize("mete/feed/name", "Activity")}
			style={{ maxWidth: "960px", marginTop: "16px" }}
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
					style={{ marginTop: "8px" }}
					onClick={() => setHeld(undefined)}
				>
					{nls.localize("mete/feed/newer", "Show {0} new", waiting)}
				</button>
			) : null}
			{rows.length > 0 ? (
				<ol style={{ ...LIST, gap: 0 }}>
					{rows.map((r) => (
						<Row key={r.event.id} {...r} names={names} />
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
