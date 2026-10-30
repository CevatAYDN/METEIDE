import { type NoteType, NoteTypeSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { type MemoryNote, sortNotes, typeCounts } from "../domain/memory.js";
import {
	type MemorySearch,
	SearchBox,
	SearchResults,
} from "./memory-search.js";
import { Icon } from "./roster-look.js";
import { ScreenHero } from "./screen-hero.js";
import { noFolderText } from "./status-text.js";
import { when } from "./time-text.js";

// The Memory screen (docs/13, Knowledge; ADR-159): the workspace vault's notes newest first, each
// with its type, date, source, tags and private mark, chips that filter by type, and Open. Rows
// wrap rather than scroll sideways. Laid out by style/mete-memory.css.

/** A note as the view draws it: the note and the URL it opens. */
export type MemoryItem = MemoryNote & { readonly url: string };

/** What the view draws: waiting, no folder, why reading failed, or the notes. */
export type MemoryModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "notes"; readonly notes: readonly MemoryItem[] };

type Filter = NoteType | "all";

const ICONS: Readonly<Record<NoteType, string>> = {
	decision: "law",
	lesson: "lightbulb",
	entity: "bookmark",
	journal: "notebook",
	inbox: "inbox",
};

// One literal nls.localize call per type, so Theia's nls-extract can read each text.
const typeName = (t: NoteType) =>
	({
		decision: nls.localize("mete/memory/decision", "Decision"),
		lesson: nls.localize("mete/memory/lesson", "Lesson"),
		entity: nls.localize("mete/memory/entity", "Entity"),
		journal: nls.localize("mete/memory/journal", "Journal"),
		inbox: nls.localize("mete/memory/inbox", "Inbox"),
	})[t];

const filterName = (f: Filter) =>
	({
		all: nls.localize("mete/memory/all", "All"),
		decision: nls.localize("mete/memory/decisions", "Decisions"),
		lesson: nls.localize("mete/memory/lessons", "Lessons"),
		entity: nls.localize("mete/memory/entities", "Entities"),
		journal: nls.localize("mete/memory/journal", "Journal"),
		inbox: nls.localize("mete/memory/inbox", "Inbox"),
	})[f];

/** Where a note came from, in words: a run by its id's first 8 characters, or the human. */
export const sourceText = (source?: string) => {
	if (source === undefined) return undefined;
	if (source.startsWith("run/"))
		return nls.localize(
			"mete/memory/fromRun",
			"From run {0}",
			source.slice(4, 12),
		);
	return source === "human"
		? nls.localize("mete/memory/fromYou", "Written by you")
		: source;
};

const Meta = ({ note }: { readonly note: MemoryItem }) => {
	const parts = [
		typeName(note.type),
		note.at ? when(note.at) : undefined,
		sourceText(note.source),
	].filter((p) => p !== undefined);
	return (
		<span className="mete-memory-meta">
			{parts.join(" · ")}
			{note.private ? (
				<span className="mete-memory-private">
					<Icon name="lock" />
					{nls.localize("mete/memory/private", "Private")}
				</span>
			) : null}
		</span>
	);
};

const Row = ({
	note,
	onOpen,
}: {
	readonly note: MemoryItem;
	readonly onOpen: (url: string) => void;
}) => (
	<li className="mete-memory-row">
		<span className="mete-tile" aria-hidden="true">
			<Icon name={ICONS[note.type]} />
		</span>
		<div className="mete-memory-main">
			<span className="mete-memory-title">{note.title}</span>
			<Meta note={note} />
			{note.tags.length > 0 ? (
				<ul className="mete-memory-tags">
					{note.tags.map((t) => (
						<li key={t}>{t}</li>
					))}
				</ul>
			) : null}
		</div>
		<button
			type="button"
			className="mete-button quiet"
			onClick={() => onOpen(note.url)}
			aria-label={nls.localize("mete/memory/openNamed", "Open {0}", note.title)}
		>
			<Icon name="go-to-file" />
			{nls.localize("mete/assets/openFile", "Open")}
		</button>
	</li>
);

// All first, then each type that has notes, with its count.
const Chips = ({
	notes,
	filter,
	onFilter,
}: {
	readonly notes: readonly MemoryItem[];
	readonly filter: Filter;
	readonly onFilter: (f: Filter) => void;
}) => {
	const counts = typeCounts(notes);
	const shown: [Filter, number][] = [
		["all", notes.length],
		...NoteTypeSchema.options
			.filter((t) => counts[t] > 0)
			.map((t): [Filter, number] => [t, counts[t]]),
	];
	return (
		<fieldset
			className="mete-segmented small mete-memory-chips"
			aria-label={nls.localize("mete/memory/show", "Show")}
		>
			{shown.map(([f, n]) => (
				<button
					key={f}
					type="button"
					aria-pressed={f === filter}
					onClick={() => onFilter(f)}
				>
					{nls.localize("mete/memory/chip", "{0} {1}", filterName(f), n)}
				</button>
			))}
		</fieldset>
	);
};

const Empty = ({ onNewRun }: { readonly onNewRun: () => void }) => (
	<div className="mete-memory-empty">
		<p>
			{nls.localize(
				"mete/memory/none",
				"No notes yet. When a run ends, its report is written to the journal; a team task that keeps lessons saves what it learned; agents can save decisions and notes. They all appear here.",
			)}
		</p>
		<button type="button" className="mete-button" onClick={onNewRun}>
			<Icon name="play" />
			{nls.localize("mete/home/newRun", "New run")}
		</button>
	</div>
);

const Notes = (props: {
	readonly notes: readonly MemoryItem[];
	readonly onOpen: (url: string) => void;
	readonly onNewRun: () => void;
	readonly search?: MemorySearch | undefined;
	readonly onSearch: (query: string) => void;
}) => {
	const [filter, setFilter] = useState<Filter>("all");
	if (props.notes.length === 0) return <Empty onNewRun={props.onNewRun} />;
	const shown = sortNotes(props.notes).filter(
		(n) => filter === "all" || n.type === filter,
	);
	const box = <SearchBox onSearch={props.onSearch} />;
	if (props.search)
		return (
			<>
				{box}
				<SearchResults
					search={props.search}
					typeName={typeName}
					onOpen={props.onOpen}
				/>
			</>
		);
	return (
		<>
			{box}
			<Chips notes={props.notes} filter={filter} onFilter={setFilter} />
			<ul
				className="mete-memory-list"
				aria-label={nls.localize("mete/memory/title", "Memory")}
			>
				{shown.map((n) => (
					<Row key={n.path} note={n} onOpen={props.onOpen} />
				))}
			</ul>
		</>
	);
};

type Actions = {
	readonly onOpen: (url: string) => void;
	readonly onNewRun: () => void;
	readonly search?: MemorySearch | undefined;
	readonly onSearch: (query: string) => void;
};

const Body = ({
	model,
	...actions
}: Actions & { readonly model: MemoryModel }) => {
	if (model.kind === "loading")
		return (
			<p className="mete-assets-state">
				{nls.localize("mete/memory/loading", "Reading the memory…")}
			</p>
		);
	if (model.kind === "no_folder")
		return <p className="mete-assets-state">{noFolderText()}</p>;
	if (model.kind === "failed")
		return (
			<p className="mete-assets-state" role="alert">
				{model.message}
			</p>
		);
	return <Notes notes={model.notes} {...actions} />;
};

/** The Memory screen for a model, with its Refresh button and the search it shows, if any. */
export const MemoryView = ({
	onRefresh,
	...props
}: Actions & {
	readonly model: MemoryModel;
	readonly onRefresh: () => void;
}) => (
	<section className="mete-screen mete-memory" aria-live="polite">
		<ScreenHero
			compact
			icon="book"
			title={nls.localize("mete/memory/title", "Memory")}
			caption={nls.localize(
				"mete/memory/caption",
				"METE: what the agents learned and what the runs left",
			)}
			actions={
				<button type="button" className="mete-button quiet" onClick={onRefresh}>
					<Icon name="refresh" />
					{nls.localize("mete/home/refresh", "Refresh")}
				</button>
			}
		/>
		<Body {...props} />
	</section>
);
