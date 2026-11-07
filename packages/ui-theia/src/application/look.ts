import type { CSSProperties } from "react";

// ADR-180: compact shared layout on neutral theme surfaces, with semantic Theia fallbacks.

const ink = "var(--ink, var(--theia-foreground))";
const muted = "var(--muted, var(--theia-descriptionForeground))";
const line = "var(--line, var(--theia-panel-border))";

/** A panel's body: its sections stacked. */
export const PANEL: CSSProperties = {
	padding: "12px",
	color: ink,
	display: "flex",
	flexDirection: "column",
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
	borderBottom: `1px solid ${line}`,
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
