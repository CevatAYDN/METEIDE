import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";

// The Workspaces section of the METE view (docs/13, Home; ADR-078), in the side view's look of the
// design set (ADR-128, style/mete-side.css).

/** A folder METE was opened on, newest first; `current` is the one open now. */
export type Workspace = {
	readonly uri: string;
	readonly name: string;
	readonly path: string;
	readonly current: boolean;
};

/** What the section asks the widget for. */
export type WorkspaceActions = {
	readonly onOpen: (uri: string) => void;
	readonly onForget: (uri: string) => void;
	readonly onAdd: () => void;
};

// The subtitle carries the folder that holds the workspace in one ellipsised line; the row's
// tooltip keeps the whole path.
const TAIL = 32;

const parentOf = (w: Workspace) =>
	w.path.slice(0, Math.max(0, w.path.length - w.name.length - 1));

const cutFront = (parent: string) => {
	if (parent.length <= TAIL) return parent;
	// The cut starts at a separator, so no segment shows half its name.
	const cut = parent.slice(-(TAIL - 1));
	const at = cut.search(/[\\/]/);
	return `…${at >= 0 ? cut.slice(at) : cut}`;
};

// Where two folders first differ, backed up to the separator before it.
const splitAt = (a: string, b: string) => {
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return Math.max(a.lastIndexOf("\\", i - 1), a.lastIndexOf("/", i - 1));
};

/**
 * The folder that holds a workspace, cut at the front: the segments next to its name tell folders
 * apart, the drive and the home folder they share do not. When a workspace of the same name in
 * `all` cuts to the same text, the folder starts where the two differ instead; the line's ellipsis
 * cuts its end.
 */
export const parentTail = (w: Workspace, all: readonly Workspace[] = []) => {
	const parent = parentOf(w);
	const tail = cutFront(parent);
	const twins = all
		.filter((o) => o.uri !== w.uri && o.name === w.name)
		.map(parentOf)
		.filter((p) => p !== parent && cutFront(p) === tail);
	if (twins.length === 0) return tail;
	const at = Math.min(...twins.map((p) => splitAt(parent, p)));
	return at > 0 ? `…${parent.slice(at)}` : parent;
};

const Row = ({
	w,
	all,
	actions,
}: {
	readonly w: Workspace;
	readonly all: readonly Workspace[];
	readonly actions: WorkspaceActions;
}) => (
	// The side view's row (ADR-109): a folder tile, the name as the title, the folder that holds it
	// in mono as the subtitle; the whole row's tooltip keeps the path.
	<li className="mete-item" title={w.path}>
		<span
			className={`mete-tile${w.current ? " accent" : ""}`}
			aria-hidden="true"
		>
			<Icon name={w.current ? "folder-opened" : "folder"} />
		</span>
		<span className="mete-side-body">
			<span className="mete-title mete-ws-name">
				{w.current ? (
					<span>
						{w.name}{" "}
						<span className="mete-side-quiet">
							{nls.localize("mete/home/currentWorkspace", "(open)")}
						</span>
					</span>
				) : (
					<button
						type="button"
						className="mete-link"
						onClick={() => actions.onOpen(w.uri)}
					>
						{w.name}
					</button>
				)}
				{w.current ? null : (
					<button
						type="button"
						className="mete-forget"
						aria-label={nls.localize(
							"mete/home/forgetWorkspace",
							"Forget {0}",
							w.name,
						)}
						onClick={() => actions.onForget(w.uri)}
					>
						{nls.localize("mete/home/forget", "Forget")}
					</button>
				)}
			</span>
			<span className="mete-sub mete-mono">{parentTail(w, all)}</span>
		</span>
	</li>
);

/**
 * The Workspaces section: the folders opened before, newest first. A click opens one, Forget drops
 * it from the list (the folder stays on disk), and Open folder adds one: the accent button while no
 * folder is open, since then it is the way to start, a quiet one otherwise.
 */
export const WorkspacesSection = ({
	workspaces,
	actions,
}: {
	readonly workspaces: readonly Workspace[];
	readonly actions: WorkspaceActions;
}) => (
	<section
		className="mete-side-section"
		aria-label={nls.localize("mete/home/workspaces", "Workspaces")}
	>
		<div className="mete-side-actions">
			<button
				type="button"
				className={
					workspaces.some((w) => w.current)
						? "mete-button quiet"
						: "mete-button"
				}
				onClick={actions.onAdd}
			>
				<Icon name="new-folder" />
				{nls.localize("mete/home/openFolder", "Open folder…")}
			</button>
		</div>
		<ul className="mete-side-list">
			{workspaces.map((w) => (
				<Row key={w.uri} w={w} all={workspaces} actions={actions} />
			))}
		</ul>
	</section>
);
