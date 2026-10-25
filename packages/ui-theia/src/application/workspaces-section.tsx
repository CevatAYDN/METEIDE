import { nls } from "@theia/core/lib/common/nls";
import { iconClass, LINK, LIST, MUTED, ROW, SECTION } from "./look.js";

// The Workspaces section of the METE view (docs/13, Home; ADR-078).

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

/**
 * The folder that holds a workspace, cut at the front: the segments next to its name tell folders
 * apart, the drive and the home folder they share do not.
 */
export const parentTail = (w: Workspace) => {
	const parent = w.path.slice(
		0,
		Math.max(0, w.path.length - w.name.length - 1),
	);
	if (parent.length <= TAIL) return parent;
	// The cut starts at a separator, so no segment shows half its name.
	const cut = parent.slice(-(TAIL - 1));
	const at = cut.search(/[\\/]/);
	return `…${at >= 0 ? cut.slice(at) : cut}`;
};

const Row = ({
	w,
	actions,
}: {
	readonly w: Workspace;
	readonly actions: WorkspaceActions;
}) => (
	// The side view's row (ADR-109): a folder tile, the name as the title, the folder that holds it
	// in mono as the subtitle; the whole row's tooltip keeps the path.
	<li className="mete-item" title={w.path}>
		<span
			className={`mete-tile${w.current ? " accent" : ""}`}
			aria-hidden="true"
		>
			<span className={iconClass(w.current ? "folder-active" : "folder")} />
		</span>
		<span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
			<span className="mete-title">
				{w.current ? (
					<span>
						{w.name}{" "}
						<span style={MUTED}>
							{nls.localize("mete/home/currentWorkspace", "(open)")}
						</span>
					</span>
				) : (
					<button
						type="button"
						style={LINK}
						onClick={() => actions.onOpen(w.uri)}
					>
						{w.name}
					</button>
				)}
				{w.current ? null : (
					<button
						type="button"
						style={{ ...LINK, ...MUTED, fontWeight: 400, marginLeft: 8 }}
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
			<span className="mete-sub mete-mono">{parentTail(w)}</span>
		</span>
	</li>
);

/**
 * The Workspaces section: the folders opened before, newest first. A click opens one, Forget drops
 * it from the list (the folder stays on disk), and Open folder adds one.
 */
export const WorkspacesSection = ({
	workspaces,
	actions,
}: {
	readonly workspaces: readonly Workspace[];
	readonly actions: WorkspaceActions;
}) => (
	<section
		style={SECTION}
		aria-label={nls.localize("mete/home/workspaces", "Workspaces")}
	>
		<div style={ROW}>
			<button type="button" className="mete-button" onClick={actions.onAdd}>
				{nls.localize("mete/home/openFolder", "Open folder…")}
			</button>
		</div>
		<ul style={LIST}>
			{workspaces.map((w) => (
				<Row key={w.uri} w={w} actions={actions} />
			))}
		</ul>
	</section>
);
