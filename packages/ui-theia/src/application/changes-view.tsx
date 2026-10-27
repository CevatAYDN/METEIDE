import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import { DIFF_LINES } from "../defaults.js";
import type { Changes } from "../domain/status-service.js";
import { Icon } from "./roster-look.js";
import { ScreenHero } from "./screen-hero.js";

// The Changes panel (ADR-100, ADR-128): the open folder's working tree as vcs.git@2 reads it, one row
// per file with a word for how it stands, and the diff of the row that is clicked. Laid out by
// style/mete-changes.css.

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

// The glyph of how a file stands, so the word is never alone.
const CHANGE_ICONS: Readonly<Record<ChangedFile["change"], string>> = {
	added: "diff-added",
	untracked: "diff-added",
	modified: "diff-modified",
	renamed: "diff-renamed",
	deleted: "diff-removed",
};

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

const Change = ({ change }: { readonly change: ChangedFile["change"] }) => (
	<span className={`mete-change ${change}`}>
		<Icon name={CHANGE_ICONS[change]} />
		{changeWord(change)}
	</span>
);

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
		<Icon name="go-to-file" />
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

const Rows = ({
	files,
	picked,
	onPick,
}: {
	readonly files: readonly ChangedFile[];
	readonly picked?: string;
	readonly onPick: (path: string) => void;
}) => (
	<section
		className="mete-changes-list"
		aria-label={nls.localize("mete/changes/files", "Changed files")}
	>
		<ul>
			{files.map((f) => (
				<li key={f.path}>
					<button
						type="button"
						className="mete-changes-row"
						aria-pressed={f.path === picked}
						title={f.path}
						onClick={() => onPick(f.path)}
					>
						<Change change={f.change} />
						<span className="mete-changes-path">{f.path}</span>
					</button>
				</li>
			))}
		</ul>
	</section>
);

// The picked file: how it stands, its path and Open file over its diff, or why it has none.
const Picked = ({
	file,
	diff,
	onOpen,
}: {
	readonly file: ChangedFile;
	readonly diff: string | undefined;
	readonly onOpen: (path: string) => void;
}) => (
	<section className="mete-changes-picked">
		<div>
			<Change change={file.change} />
			<code>{file.path}</code>
			{openable(file.change) ? <OpenFile file={file} onOpen={onOpen} /> : null}
		</div>
		{diff === undefined ? (
			<p className="mete-changes-state">
				{nls.localize(
					"mete/changes/noDiff",
					"No diff: git does not track this file yet, so open it to read it.",
				)}
			</p>
		) : (
			<Diff text={diff} />
		)}
	</section>
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
	if (changes.files.length === 0)
		return (
			<p className="mete-changes-state">
				{nls.localize("mete/changes/clean", "No changes.")}
			</p>
		);
	return (
		<div className="mete-changes-columns">
			<Rows
				files={changes.files}
				{...(picked === undefined ? {} : { picked })}
				onPick={controls.onPick}
			/>
			{pickedFile === undefined ? null : (
				<Picked
					file={pickedFile}
					diff={changes.diff}
					onOpen={controls.onOpen}
				/>
			)}
		</div>
	);
};

// What the hero says under the title: the files and the branch, or the tab's caption before they are known.
const captionOf = (model: ChangesModel): ReactNode =>
	model.kind === "files" ? (
		<>
			{countText(model.changes.files.length)}
			{model.changes.branch ? (
				<>
					<span className="mete-changes-sep"> · </span>
					<span className="mete-changes-branch">
						<Icon name="git-branch" />
						{model.changes.branch}
					</span>
				</>
			) : null}
		</>
	) : (
		nls.localize("mete/changes/caption", "METE: what changed in this folder")
	);

const Notice = ({ model }: { readonly model: ChangesModel }) => {
	switch (model.kind) {
		case "loading":
			return nls.localize("mete/changes/loading", "Reading the working tree…");
		case "no_folder":
			return nls.localize(
				"mete/changes/noFolder",
				"Open a folder to see its changes.",
			);
		case "no_git":
			return nls.localize(
				"mete/changes/noGit",
				"This folder is not a git repository. A run's checkpoints can still put its files back.",
			);
		case "failed":
			return model.message;
		default:
			return null;
	}
};

/** The Changes panel of the open folder (ADR-100). */
export const ChangesView = ({
	model,
	controls,
}: {
	readonly model: ChangesModel;
	readonly controls: ChangesControls;
}) => (
	<section
		className="mete-screen mete-changes"
		aria-label={nls.localize("mete/changes/title", "Changes")}
	>
		<ScreenHero
			compact
			icon="diff"
			title={nls.localize("mete/changes/title", "Changes")}
			caption={captionOf(model)}
			actions={
				<button
					type="button"
					className="mete-button quiet"
					onClick={controls.onRefresh}
				>
					<Icon name="refresh" />
					{nls.localize("mete/changes/refresh", "Refresh")}
				</button>
			}
		/>
		{model.kind === "files" ? (
			<Files model={model} controls={controls} />
		) : (
			<p className="mete-changes-state">
				<Notice model={model} />
			</p>
		)}
	</section>
);
