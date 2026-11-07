import type { ReactNode } from "react";
import { Icon } from "./roster-look.js";

// ADR-180: shared compact screen header, retaining each screen's facts and actions.

/** A main screen's header. `compact` trims its trailing space on dashboards. */
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
					<h2 title={title}>{title}</h2>
					{caption ? <p>{caption}</p> : null}
				</div>
				{actions}
			</div>
			{children}
		</div>
		{aside}
	</header>
);
