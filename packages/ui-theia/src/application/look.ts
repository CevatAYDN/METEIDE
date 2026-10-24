import type { CSSProperties } from "react";

// The panels' shared styles (docs/13 Design system, ADR-069): each colour is a METE token with a
// Theia colour as its fallback, which a high-contrast theme uses, since its panel root sets no tokens.
// The shape and Baloo 2 come from style/mete.css through the root's class.

const ink = "var(--ink, var(--theia-foreground))";
const muted = "var(--muted, var(--theia-descriptionForeground))";
const line = "var(--line, var(--theia-panel-border))";

/** A panel's body: its sections stacked. */
export const PANEL: CSSProperties = {
	padding: "16px",
	color: ink,
	display: "flex",
	flexDirection: "column",
	gap: "14px",
};

/** A section of the METE view, under its part's header in the narrow side bar. */
export const SECTION: CSSProperties = {
	...PANEL,
	padding: "8px 12px 12px",
	gap: "10px",
};

/** A panel's section heading. */
export const TITLE: CSSProperties = {
	margin: 0,
	fontSize: "1.15em",
	fontWeight: 700,
};

/** Secondary text. */
export const MUTED: CSSProperties = { color: muted };

/** A row of controls that wraps. */
export const ROW: CSSProperties = {
	display: "flex",
	gap: "8px",
	flexWrap: "wrap",
	alignItems: "center",
};

/** A table that fills its panel. */
export const TABLE: CSSProperties = {
	borderCollapse: "collapse",
	width: "100%",
};

/** A table cell. */
export const CELL: CSSProperties = {
	textAlign: "left",
	padding: "6px 8px",
	borderBottom: `1.5px solid ${line}`,
	verticalAlign: "top",
};

/** A button that reads as a link, such as a run's goal. */
export const LINK: CSSProperties = {
	background: "none",
	border: "none",
	padding: 0,
	color: "var(--accent, var(--theia-textLink-foreground))",
	cursor: "pointer",
	font: "inherit",
	fontWeight: 600,
	textAlign: "left",
};

/** A list without bullets. */
export const LIST: CSSProperties = {
	listStyle: "none",
	padding: 0,
	margin: "6px 0 0",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
};
