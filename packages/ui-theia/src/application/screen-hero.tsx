import type { ReactNode } from "react";
import { Icon } from "./roster-look.js";

// The hero band the main screens share (ADR-128): a tile with the screen's glyph, its title with the
// caption of its tab, the actions beside them, what the screen adds under them and an aside at the
// right. Laid out by style/mete-screen.css.

/** The hero band of a main screen. `compact` is the dashboards' slimmer band. */
export const ScreenHero = ({
	icon,
	title,
	caption,
	actions,
	compact,
	children,
	aside,
}: {
	readonly icon: string;
	readonly title: string;
	readonly caption: ReactNode;
	readonly actions?: ReactNode;
	readonly compact?: boolean;
	readonly children?: ReactNode;
	readonly aside?: ReactNode;
}) => (
	<header className={compact ? "mete-screen-hero compact" : "mete-screen-hero"}>
		<div className="mete-screen-intro">
			<div className="mete-screen-headline">
				<span className="mete-screen-tile">
					<Icon name={icon} />
				</span>
				<div className="mete-screen-title">
					<h2>{title}</h2>
					<p>{caption}</p>
				</div>
				{actions}
			</div>
			{children}
		</div>
		{aside}
	</header>
);
