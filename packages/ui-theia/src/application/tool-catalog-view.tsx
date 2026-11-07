import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import {
	type CatalogDraft,
	type CatalogState,
	catalogBlocked,
	type ToolCatalog,
} from "./tool-catalog.js";

const Draft = ({
	draft,
	onAdd,
}: {
	readonly draft: CatalogDraft;
	readonly onAdd: () => void;
}) => (
	<section className="mete-tools-review">
		<h4>{draft.server.id}</h4>
		<code>{draft.source}</code>
		<pre>{JSON.stringify(draft.server, null, 2)}</pre>
		{"fields" in draft && draft.fields.length ? (
			<ul className="mete-tools-note">
				{draft.fields.map((field) => (
					<li key={`${field.kind}:${field.name}`}>
						{field.name}{" "}
						{field.required
							? nls.localize(
									"mete/tools/credentialsRequired",
									"Credentials required",
								)
							: null}
					</li>
				))}
			</ul>
		) : null}
		{draft.notes.length ? (
			<div role="status">
				<strong>
					{nls.localize("mete/tools/setupRequired", "Setup required")}
				</strong>
				<ul>
					{draft.notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			</div>
		) : null}
		<button
			type="button"
			className="mete-button"
			disabled={catalogBlocked(draft)}
			onClick={onAdd}
		>
			<Icon name="add" />
			{nls.localize("mete/tools/addDraft", "Add draft")}
		</button>
	</section>
);

/** Opening a catalog never searches until its form is submitted. */
export const ToolCatalogView = ({
	catalog,
}: {
	readonly catalog: ToolCatalog;
}) => {
	const state = catalog.state;
	return (
		<section className="mete-tools-catalog" aria-busy={state.busy}>
			<form
				className="mete-tools-form"
				onSubmit={(event) => {
					event.preventDefault();
					void catalog.search();
				}}
			>
				<input
					type="search"
					className="mete-field"
					value={state.query}
					aria-label={nls.localize(
						"mete/tools/searchCatalog",
						"Search tool catalog",
					)}
					placeholder={nls.localize(
						"mete/tools/searchCatalog",
						"Search tool catalog",
					)}
					onChange={(event) => catalog.query(event.target.value)}
				/>
				<button
					type="submit"
					className="mete-button quiet icon"
					disabled={state.busy || !state.query.trim()}
					title={nls.localize("mete/tools/search", "Search")}
					aria-label={nls.localize("mete/tools/search", "Search")}
				>
					<Icon name={state.busy ? "loading" : "search"} spin={state.busy} />
				</button>
			</form>
			{state.error ? (
				<p role="alert" className="mete-tools-error">
					{state.error}
				</p>
			) : null}
			{state.entries?.length === 0 ? (
				<p role="status">
					{nls.localize("mete/tools/catalogEmpty", "No tools found.")}
				</p>
			) : null}
			<CatalogResults
				state={state}
				onPrepare={(id) => void catalog.prepare(id)}
			/>
			{state.draft ? (
				<Draft draft={state.draft} onAdd={() => catalog.add()} />
			) : null}
		</section>
	);
};

const CatalogResults = ({
	state,
	onPrepare,
}: {
	readonly state: CatalogState;
	readonly onPrepare: (id: string) => void;
}) => (
	<div className="mete-tools-results">
		{state.entries?.map((entry) => (
			<div key={entry.id} className="mete-tools-result">
				<div>
					<strong>{entry.id}</strong>
					<span>
						{entry.version} · {entry.runtime}
					</span>
					<p>{entry.description}</p>
				</div>
				<button
					type="button"
					className="mete-button quiet"
					disabled={state.busy}
					onClick={() => onPrepare(entry.id)}
				>
					{nls.localize("mete/tools/prepare", "Prepare")}
				</button>
			</div>
		))}
	</div>
);
