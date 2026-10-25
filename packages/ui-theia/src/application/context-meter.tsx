import { nls } from "@theia/core/lib/common/nls";
import { CONTEXT_WARN_SHARE } from "../defaults.js";
import type { Member } from "../domain/roster.js";
import { MUTED } from "./look.js";
import { tokenCount } from "./numbers.js";
import { Icon, LINE } from "./roster-look.js";

// A Team view row's context line (ADR-090): the latest call's share of its model's context window,
// and the tokens and calls of every agent of the role.

/** The listed context window of each model, by `<providerId>/<modelId>` (ADR-090). */
export type Windows = Readonly<Record<string, number>>;

// The latest call's share of its model's context; the bar warns from CONTEXT_WARN_SHARE, the text
// always says the number. A model with no listed window shows the tokens alone (ADR-090). The bar
// is the design system's meter (ADR-107): `--p` is the fill's share, the tone class its colour.
const Share = ({
	last,
	window,
}: {
	readonly last: { readonly prompt: number };
	readonly window: number;
}) => {
	const share = last.prompt / window;
	const tone = share >= CONTEXT_WARN_SHARE ? "warn" : "";
	return (
		<>
			<span
				className={`mete-meter${tone ? ` ${tone}` : ""}`}
				aria-hidden="true"
				style={{ width: "96px", flex: "none" }}
			>
				<i style={{ ["--p" as string]: `${Math.min(100, share * 100)}%` }} />
			</span>
			<span>
				{nls.localize(
					"mete/roster/context",
					"Context {0}% · {1} of {2}",
					// A share that rounds to 0 is still some context used.
					share > 0 && share < 0.005 ? "<1" : Math.round(share * 100),
					tokenCount(last.prompt),
					tokenCount(window),
				)}
			</span>
			<span aria-hidden="true">·</span>
		</>
	);
};

/** A member's context share and tokens; nothing before its first call with usage. */
export const Context = ({
	member,
	windows,
}: {
	readonly member: Member;
	readonly windows: Windows;
}) => {
	const last = member.agent?.usage?.last;
	const window = last ? windows[`${last.providerId}/${last.modelId}`] : 0;
	if (!member.used) return null;
	return (
		<div style={{ ...LINE, ...MUTED }}>
			<Icon name="layers" />
			{last && window ? <Share last={last} window={window} /> : null}
			<span>
				{nls.localize(
					"mete/roster/tokens",
					"Tokens: {0} · calls: {1}",
					tokenCount(member.used.tokens),
					member.used.calls,
				)}
			</span>
		</div>
	);
};
