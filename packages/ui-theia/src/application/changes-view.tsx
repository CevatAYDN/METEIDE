import { nls } from "@theia/core/lib/common/nls";
import { DIFF_LINES } from "../defaults.js";
import type { Changes } from "../domain/status-service.js";
import { LIST, MUTED, ROW, TITLE } from "./look.js";

// The Changes panel (ADR-100): the open folder's working tree as vcs.git@2 reads it, one row per
// file with a word for how it stands, and the diff of the row that is clicked.

/** A changed file as mete/changes lists it. */
type ChangedFile = Changes["files"][number];

/** What the panel shows: the request's answer, or why it has none. */
export type ChangesModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "no_git" }
	| { readonly kind: "failed"; readonly message: string }
	| {
			readonly kind: "files";
			readonly changes: Changes;
			readonly picked?: string;
	  };

/** What the panel asks the widget to do. */
export type ChangesControls = {
	readonly onPick: (path: string) => void;
	readonly onRefresh: () => void;
	readonly onOpen: (path: string) => void;
};

/** The word a changed file shows; no git term reaches the panel (ADR-100). */
export const changeWord = (change: ChangedFile["change"]) => {
	switch (change) {
		case "added":
			return nls.localize("mete/changes/added", "Added");
		case "deleted":
			return nls.localize("mete/changes/deleted", "Deleted");
		case "renamed":
			return nls.localize("mete/changes/renamed", "Renamed");
		case "untracked":
			return nls.localize("mete/changes/new", "New");
		default:
			return nls.localize("mete/changes/changed", "Changed");
	}
};

/** "1 changed file", "3 changed files". */
export const countText = (n: number) =>
	n === 1
		? nls.localize("mete/changes/one", "1 changed file")
		: nls.localize("mete/changes/count", "{0} changed files", n);

/** A diff line's colour: additions, removals, the hunks and the rest (ADR-100). */
const toneOf = (line: string) => {
	if (line.startsWith("@@")) return "hunk";
	if (line.startsWith("+++") || line.startsWith("---")) return "head";
	if (line.startsWith("+")) return "add";
	if (line.startsWith("-")) return "del";
	return "plain";
};

/** A picked file can be opened in the editor unless the working tree no longer holds it (ADR-102). */
const openable = (change: ChangedFile["change"]) => change !== "deleted";

/** Opens the picked file with the widget's opener (ADR-102). */
const OpenFile = ({
	file,
	onOpen,
}: {
	readonly file: ChangedFile;
	readonly onOpen: (path: string) => void;
}) => (
	<button
		type="button"
		className="mete-button quiet"
		onClick={() => onOpen(file.path)}
	>
		{nls.localize("mete/changes/openFile", "Open file")}
	</button>
);

const Diff = ({ text }: { readonly text: string }) => {
	const lines = text.split("\n");
	const shown = lines.slice(0, DIFF_LINES).map((line, index) => ({
		key: `${index}:${line}`,
		line,
	}));
	return (
		<section
			className="mete-diff"
			aria-label={nls.localize("mete/changes/diff", "Diff")}
		>
			{shown.map(({ key, line }) => (
				<span key={key} className={`mete-diff-line ${toneOf(line)}`}>
					{line}
					{"\n"}
				</span>
			))}
			{lines.length > shown.length ? (
				<span className="mete-diff-line">
					{nls.localize(
						"mete/changes/cut",
						"… {0} more lines, open the file to read the rest.",
						lines.length - shown.length,
					)}
				</span>
			) : null}
		</section>
	);
};

const Header = ({ onRefresh }: { readonly onRefresh: () => void }) => (
	<header style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
		<h3 style={TITLE}>{nls.localize("mete/changes/title", "Changes")}</h3>
		<button type="button" className="mete-button quiet" onClick={onRefresh}>
			{nls.localize("mete/changes/refresh", "Refresh")}
		</button>
	</header>
);

const Rows = ({
	files,
	picked,
	onPick,
}: {
	readonly files: readonly ChangedFile[];
	readonly picked?: string;
	readonly onPick: (path: string) => void;
}) => (
	<ul style={LIST}>
		{files.map((f) => (
			<li key={f.path} style={ROW}>
				<button
					type="button"
					className="mete-changes-row"
					aria-pressed={f.path === picked}
					onClick={() => onPick(f.path)}
				>
					<span className={`mete-change ${f.change}`}>
						{changeWord(f.change)}
					</span>
					<span className="mete-changes-path">{f.path}</span>
				</button>
			</li>
		))}
	</ul>
);

const Files = ({
	model,
	controls,
}: {
	readonly model: Extract<ChangesModel, { kind: "files" }>;
	readonly controls: ChangesControls;
}) => {
	const { changes, picked } = model;
	const pickedFile = changes.files.find((f) => f.path === picked);
	return (
		<>
			<p style={MUTED}>
				{countText(changes.files.length)}
				{changes.branch ? ` · ${changes.branch}` : ""}
			</p>
			{changes.files.length === 0 ? (
				<p style={MUTED}>{nls.localize("mete/changes/clean", "No changes.")}</p>
			) : (
				<Rows
					files={changes.files}
					{...(picked === undefined ? {} : { picked })}
					onPick={controls.onPick}
				/>
			)}
			{pickedFile !== undefined && openable(pickedFile.change) ? (
				<OpenFile file={pickedFile} onOpen={controls.onOpen} />
			) : null}
			{picked === undefined ? null : changes.diff === undefined ? (
				<p style={MUTED}>
					{nls.localize(
						"mete/changes/noDiff",
						"No diff: git does not track this file yet, so open it to read it.",
					)}
				</p>
			) : (
				<Diff text={changes.diff} />
			)}
		</>
	);
};

/** The Changes panel of the open folder (ADR-100). */
export const ChangesView = ({
	model,
	controls,
}: {
	readonly model: ChangesModel;
	readonly controls: ChangesControls;
}) => (
	<section aria-label={nls.localize("mete/changes/title", "Changes")}>
		<Header onRefresh={controls.onRefresh} />
		{model.kind === "loading" ? (
			<p style={MUTED}>
				{nls.localize("mete/changes/loading", "Reading the working tree…")}
			</p>
		) : null}
		{model.kind === "no_folder" ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/changes/noFolder",
					"Open a folder to see its changes.",
				)}
			</p>
		) : null}
		{model.kind === "no_git" ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/changes/noGit",
					"This folder is not a git repository. A run's checkpoints can still put its files back.",
				)}
			</p>
		) : null}
		{model.kind === "failed" ? <p style={MUTED}>{model.message}</p> : null}
		{model.kind === "files" ? (
			<Files model={model} controls={controls} />
		) : null}
	</section>
);
