import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { LINK, LIST, MUTED, ROW, SECTION } from "./look.js";

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

// One line that ends in an ellipsis; the tooltip holds the whole path.
const ONE_LINE: CSSProperties = {
	...MUTED,
	display: "block",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
};

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
	<li title={w.path}>
		<span style={{ ...ROW, justifyContent: "space-between" }}>
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
					style={{ ...LINK, ...MUTED, fontWeight: 400 }}
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
		<span style={ONE_LINE}>{parentTail(w)}</span>
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
		<button type="button" className="mete-button" onClick={actions.onAdd}>
			{nls.localize("mete/home/openFolder", "Open folder…")}
		</button>
		<ul style={LIST}>
			{workspaces.map((w) => (
				<Row key={w.uri} w={w} actions={actions} />
			))}
		</ul>
	</section>
);
