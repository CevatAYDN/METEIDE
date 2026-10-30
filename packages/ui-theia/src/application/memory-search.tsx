import type { NoteType } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { Icon } from "./roster-look.js";

// The Memory screen's search (docs/13, Knowledge; ADR-159): a labelled box that asks the daemon's
// mete/knowledge.search on Enter, and the hits best first, each with its heading, snippet and Open.
// Emptying the box shows the notes again.

/** A hit as the screen draws it: knowledge.search@1's hit and the URL it opens. */
export type SearchItem = {
	readonly path: string;
	readonly type: NoteType;
	readonly title: string;
	readonly heading?: string | undefined;
	readonly snippet: string;
	readonly url: string;
};

/** The search the screen shows: waiting, its hits, or why it failed. */
export type MemorySearch =
	| { readonly kind: "searching"; readonly query: string }
	| {
			readonly kind: "hits";
			readonly query: string;
			readonly hits: readonly SearchItem[];
	  }
	| {
			readonly kind: "failed";
			readonly query: string;
			readonly message: string;
	  };

/** The search box; an empty box asks for the notes again. */
export const SearchBox = ({
	onSearch,
}: {
	readonly onSearch: (query: string) => void;
}) => {
	const [text, setText] = useState("");
	return (
		<search>
			<form
				className="mete-memory-search"
				onSubmit={(e) => {
					e.preventDefault();
					onSearch(text.trim());
				}}
			>
				<label htmlFor="mete-memory-query">
					{nls.localize("mete/memory/search", "Search memory")}
				</label>
				<input
					id="mete-memory-query"
					type="search"
					className="theia-input"
					value={text}
					placeholder={nls.localize(
						"mete/memory/searchHint",
						"Words from your notes, then Enter",
					)}
					onChange={(e) => {
						setText(e.target.value);
						if (e.target.value.trim() === "") onSearch("");
					}}
				/>
				<button type="submit" className="mete-button quiet">
					<Icon name="search" />
					{nls.localize("mete/memory/searchButton", "Search")}
				</button>
			</form>
		</search>
	);
};

const Hit = ({
	hit,
	typeName,
	onOpen,
}: {
	readonly hit: SearchItem;
	readonly typeName: (t: NoteType) => string;
	readonly onOpen: (url: string) => void;
}) => (
	<li className="mete-memory-row">
		<div className="mete-memory-main">
			<span className="mete-memory-title">{hit.title}</span>
			<span className="mete-memory-meta">
				{[typeName(hit.type), hit.heading !== hit.title && hit.heading]
					.filter(Boolean)
					.join(" · ")}
			</span>
			<p className="mete-memory-snippet">{hit.snippet}</p>
		</div>
		<button
			type="button"
			className="mete-button quiet"
			onClick={() => onOpen(hit.url)}
			aria-label={nls.localize("mete/memory/openNamed", "Open {0}", hit.title)}
		>
			<Icon name="go-to-file" />
			{nls.localize("mete/assets/openFile", "Open")}
		</button>
	</li>
);

/** What a search found, or why it found nothing. */
export const SearchResults = ({
	search,
	typeName,
	onOpen,
}: {
	readonly search: MemorySearch;
	readonly typeName: (t: NoteType) => string;
	readonly onOpen: (url: string) => void;
}) => {
	if (search.kind === "searching")
		return (
			<p className="mete-assets-state">
				{nls.localize("mete/memory/searching", "Searching…")}
			</p>
		);
	if (search.kind === "failed")
		return (
			<p className="mete-assets-state" role="alert">
				{search.message}
			</p>
		);
	if (search.hits.length === 0)
		return (
			<p className="mete-assets-state">
				{nls.localize(
					"mete/memory/nothing",
					"Nothing found for “{0}”. Try other words, or fewer of them.",
					search.query,
				)}
			</p>
		);
	return (
		<>
			<p className="mete-memory-found">
				{nls.localize(
					"mete/memory/found",
					"{0} found for “{1}”",
					search.hits.length,
					search.query,
				)}
			</p>
			<ul className="mete-memory-list">
				{search.hits.map((h) => (
					<Hit
						key={`${h.path}#${h.heading ?? ""}#${h.snippet}`}
						hit={h}
						typeName={typeName}
						onOpen={onOpen}
					/>
				))}
			</ul>
		</>
	);
};
