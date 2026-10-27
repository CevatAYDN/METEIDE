import type { ReactNode } from "react";
import { Icon } from "./roster-look.js";
import { toneStyle } from "./tone.js";

// A card (ADR-128): a tile in the wait's tone, then the kind of wait as a wash pill, when the events
// tell it, over the sentence that names the member, and the card's own parts under them.
export const Card = ({
	tone,
	icon,
	title,
	kind,
	children,
}: {
	readonly tone: "warn" | "bad";
	readonly icon: string;
	readonly title: string;
	readonly kind?: { readonly icon?: string; readonly word: string };
	readonly children: ReactNode;
}) => (
	<li className="mete-wait-card" data-tone={tone} style={toneStyle(tone)}>
		<span className="mete-wait-icon" aria-hidden="true">
			<Icon name={icon} />
		</span>
		<div className="mete-wait-body">
			{kind ? (
				<span className="mete-wait-kind">
					{kind.icon ? <Icon name={kind.icon} /> : null}
					{kind.word}
				</span>
			) : null}
			<p className="mete-wait-text">{title}</p>
			{children}
		</div>
	</li>
);
