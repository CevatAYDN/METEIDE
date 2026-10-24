import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { LINK, LIST, MUTED, SECTION } from "./look.js";

// The Workspaces section of the METE view (docs/13, Home; ADR-078).

/** A folder METE was opened on, newest first; `current` is the one open now. */
export type Workspace = {
	readonly uri: string;
	readonly name: string;
	readonly path: string;
	readonly current: boolean;
};

// One line that ends in an ellipsis; the tooltip holds the whole path.
const ONE_LINE: CSSProperties = {
	...MUTED,
	display: "block",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
};

/** The Workspaces section: the folders opened before, newest first; another opens on a click. */
export const WorkspacesSection = ({
	workspaces,
	onOpen,
}: {
	readonly workspaces: readonly Workspace[];
	readonly onOpen: (uri: string) => void;
}) => (
	<section
		style={SECTION}
		aria-label={nls.localize("mete/home/workspaces", "Workspaces")}
	>
		<ul style={LIST}>
			{workspaces.map((w) => (
				<li key={w.uri} title={w.path}>
					{w.current ? (
						<span>
							{w.name}{" "}
							<span style={MUTED}>
								{nls.localize("mete/home/currentWorkspace", "(open)")}
							</span>
						</span>
					) : (
						<button type="button" style={LINK} onClick={() => onOpen(w.uri)}>
							{w.name}
						</button>
					)}
					<span style={ONE_LINE}>{w.path}</span>
				</li>
			))}
		</ul>
	</section>
);
