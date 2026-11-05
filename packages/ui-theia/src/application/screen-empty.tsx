import type { ReactNode } from "react";
import { Icon } from "./roster-look.js";

// The empty state the main screens share (Memory, Assets, Audit log, Changes): the side view's
// dashed card (ADR-128) with the screen's glyph in a tile, the sentence, and at most one action.
// Laid out by style/mete-screen.css as `.mete-screen-empty`.

/** A main screen with nothing to list yet: its glyph, one sentence and an optional action. */
export const ScreenEmpty = ({
	icon,
	text,
	action,
}: {
	readonly icon: string;
	readonly text: string;
	readonly action?: ReactNode;
}) => (
	<div className="mete-screen-empty">
		<span className="mete-screen-empty-tile" aria-hidden="true">
			<Icon name={icon} />
		</span>
		<p>{text}</p>
		{action ? <div className="mete-screen-empty-action">{action}</div> : null}
	</div>
);
