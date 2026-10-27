import type { ModelInfo, ModelRef } from "@mete/contracts";
import type { AgentCard } from "@mete/ui-studio";
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

/** The models of the run's calls whose window was not asked yet; each is marked asked. */
export const unaskedModels = (
	agents: readonly AgentCard[],
	asked: Set<string>,
): ModelRef[] =>
	agents.flatMap((a) => {
		const l = a.usage?.last;
		const k = l ? `${l.providerId}/${l.modelId}` : "";
		if (!l || asked.has(k)) return [];
		asked.add(k);
		return [{ providerId: l.providerId, modelId: l.modelId }];
	});

/** The listed models' windows; a model the listing lacks keeps none, so its row shows the tokens alone. */
export const windowsOf = (models: readonly ModelInfo[]): Windows =>
	Object.fromEntries(
		models.map((m) => [`${m.providerId}/${m.id}`, m.contextWindow]),
	);

/** The latest call's share of its model's context window. */
export type Share = {
	readonly share: number;
	/** At least CONTEXT_WARN_SHARE: the bar warns, the text always says the number. */
	readonly warn: boolean;
	/** "Context 18% · 23.5k of 131k". */
	readonly text: string;
};

/** A member's share; none before its first call with usage, or for a model the listing lacks (ADR-090). */
export const shareOf = (
	member: Member,
	windows: Windows,
): Share | undefined => {
	const last = member.agent?.usage?.last;
	const window = last ? windows[`${last.providerId}/${last.modelId}`] : 0;
	if (!last || !window) return undefined;
	const share = last.prompt / window;
	return {
		share,
		warn: share >= CONTEXT_WARN_SHARE,
		text: nls.localize(
			"mete/roster/context",
			"Context {0}% · {1} of {2}",
			// A share that rounds to 0 is still some context used.
			share > 0 && share < 0.005 ? "<1" : Math.round(share * 100),
			tokenCount(last.prompt),
			tokenCount(window),
		),
	};
};

/** The share as the design system's meter (ADR-107): `--p` is the fill's share, the tone class its colour. */
export const ShareBar = ({
	share,
	width,
}: {
	readonly share: Share;
	readonly width: string;
}) => (
	<span
		className={`mete-meter${share.warn ? " warn" : ""}`}
		aria-hidden="true"
		style={{ width, flex: "none" }}
	>
		<i style={{ ["--p" as string]: `${Math.min(100, share.share * 100)}%` }} />
	</span>
);

/** A member's context share and tokens; nothing before its first call with usage. */
export const Context = ({
	member,
	windows,
}: {
	readonly member: Member;
	readonly windows: Windows;
}) => {
	const share = shareOf(member, windows);
	if (!member.used) return null;
	return (
		<div style={{ ...LINE, ...MUTED }}>
			<Icon name="layers" />
			{share ? (
				<>
					<ShareBar share={share} width="96px" />
					<span>{share.text}</span>
					<span aria-hidden="true">·</span>
				</>
			) : null}
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
