import type { Tier } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { CONTEXT_WARN_SHARE } from "../defaults.js";
import { type Member, type MemberState, roleWords } from "../domain/roster.js";
import { LIST, MUTED } from "./look.js";

// The Team panel's fourth view (ADR-089): one row per role with its tier, model, state and what it
// does now. Icons are Theia's codicons; each state is an icon and a word, never a colour alone.

type Tone = "accent" | "warn" | "good" | "bad" | "muted";

const TONES: Readonly<Record<Tone, string>> = {
	accent: "var(--accent, var(--theia-focusBorder))",
	warn: "var(--warn, var(--theia-editorWarning-foreground))",
	good: "var(--good, var(--theia-testing-iconPassed))",
	bad: "var(--bad, var(--theia-errorForeground))",
	muted: "var(--muted, var(--theia-descriptionForeground))",
};
const MONO = "var(--theia-code-font-family, monospace)";

const Icon = ({
	name,
	spin,
}: {
	readonly name: string;
	readonly spin?: boolean;
}) => (
	<span
		aria-hidden="true"
		className={`codicon codicon-${name}${spin ? " codicon-modifier-spin" : ""}`}
	/>
);

const TIER_ICONS: Readonly<Record<Tier, string>> = {
	reasoning: "lightbulb",
	coder: "code",
	fast: "zap",
	"long-context": "book",
	vision: "eye",
};

/** A tier's plain label (ADR-089); the team file keeps the tier id. */
export const tierLabel = (tier: Tier): string =>
	({
		reasoning: nls.localize("mete/roster/reasoning", "Thinker"),
		coder: nls.localize("mete/roster/coder", "Coder"),
		fast: nls.localize("mete/roster/fast", "Fast"),
		"long-context": nls.localize("mete/roster/longContext", "Long reads"),
		vision: nls.localize("mete/roster/vision", "Sees images"),
	})[tier];

const until = (at: string) =>
	new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type Look = {
	readonly icon: string;
	readonly text: string;
	readonly tone: Tone;
	readonly spin?: boolean;
};

// The words of a state; the two with a value take it from the state.
const stateText = (s: MemberState): string => {
	if (s.kind === "quota")
		return nls.localize(
			"mete/roster/quota",
			"Waiting for quota until {0}",
			until(s.resetsAt),
		);
	if (s.kind === "working")
		return nls.localize(
			"mete/roster/working",
			"Working with {0}",
			s.tool.replace(/@\d+$/, ""),
		);
	return {
		waits_for_you: nls.localize("mete/roster/waitsForYou", "Waiting for you"),
		thinking: nls.localize("mete/roster/thinking", "Thinking"),
		blocked: nls.localize("mete/roster/blocked", "Blocked"),
		done: nls.localize("mete/roster/done", "Done"),
		idle: nls.localize("mete/roster/idle", "Idle"),
	}[s.kind];
};

const LOOKS: Readonly<Record<MemberState["kind"], Omit<Look, "text">>> = {
	waits_for_you: { icon: "bell", tone: "warn" },
	quota: { icon: "watch", tone: "warn" },
	working: { icon: "tools", tone: "accent" },
	thinking: { icon: "loading", tone: "accent", spin: true },
	blocked: { icon: "circle-slash", tone: "bad" },
	done: { icon: "pass", tone: "good" },
	idle: { icon: "circle-outline", tone: "muted" },
};

/** A member's state as an icon, a word and a tone. */
export const stateLook = (s: MemberState): Look => ({
	...LOOKS[s.kind],
	text: stateText(s),
});

const ROW: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "40px minmax(0, 1fr) auto",
	gap: "4px 14px",
	alignItems: "center",
};
const AVATAR: CSSProperties = {
	width: "40px",
	height: "40px",
	borderRadius: "11px",
	display: "grid",
	placeItems: "center",
	fontWeight: 800,
	fontSize: "1.2em",
	background: "var(--chip, var(--theia-badge-background))",
	color: "var(--accent, var(--theia-foreground))",
};
const LINE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	minWidth: 0,
	flexWrap: "wrap",
};
const PILL: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "5px",
	whiteSpace: "nowrap",
};

const Now = ({ now }: { readonly now: NonNullable<Member["now"]> }) => (
	<div style={LINE}>
		<Icon name={now.waitsFor ? "watch" : "arrow-right"} />
		<span>
			{now.waitsFor
				? nls.localize(
						"mete/roster/waitsFor",
						"{0} · waits for “{1}”",
						now.task,
						now.waitsFor,
					)
				: now.task}
		</span>
	</div>
);

const Model = ({ member }: { readonly member: Member }) =>
	member.agent ? (
		<div style={{ ...LINE, ...MUTED }}>
			<Icon name="circuit-board" />
			<span style={{ fontFamily: MONO }}>
				{member.agent.providerId} ·{" "}
				{/* Some providers' model ids start with the provider's own name. */}
				{member.agent.modelId.replace(`${member.agent.providerId}/`, "")}
			</span>
		</div>
	) : null;

/** A token count with a fixed k or M suffix, the same in every language: 61k, 1.2M. */
export const tokenCount = (n: number): string => {
	const short = (x: number) =>
		x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x));
	if (n < 1_000) return String(n);
	return n < 1_000_000 ? `${short(n / 1_000)}k` : `${short(n / 1_000_000)}M`;
};

/** The listed context window of each model, by `<providerId>/<modelId>` (ADR-090). */
export type Windows = Readonly<Record<string, number>>;

const BAR: CSSProperties = {
	width: "96px",
	height: "6px",
	borderRadius: "3px",
	overflow: "hidden",
	flex: "none",
	background: "var(--chip, var(--theia-badge-background))",
};

// The latest call's share of its model's context; the bar warns from CONTEXT_WARN_SHARE, the text
// always says the number. A model with no listed window shows the tokens alone (ADR-090).
const Share = ({
	last,
	window,
}: {
	readonly last: { readonly prompt: number };
	readonly window: number;
}) => {
	const share = last.prompt / window;
	const tone = share >= CONTEXT_WARN_SHARE ? "warn" : "accent";
	return (
		<>
			<span aria-hidden="true" style={BAR}>
				<span
					style={{
						display: "block",
						height: "100%",
						width: `${Math.min(100, share * 100)}%`,
						background: TONES[tone],
					}}
				/>
			</span>
			<span>
				{nls.localize(
					"mete/roster/context",
					"Context {0}% · {1} of {2}",
					Math.round(share * 100),
					tokenCount(last.prompt),
					tokenCount(window),
				)}
			</span>
		</>
	);
};

const Context = ({
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

const TierChip = ({ tier }: { readonly tier: Tier }) => (
	<span className="mete-chip" style={PILL} title={tier}>
		<Icon name={TIER_ICONS[tier]} />
		{tierLabel(tier)}
		<span style={{ ...MUTED, fontFamily: MONO, fontSize: "0.85em" }}>
			{tier}
		</span>
	</span>
);

const Row = ({
	member,
	name,
	windows,
}: {
	readonly member: Member;
	readonly name: string;
	readonly windows: Windows;
}) => {
	const look = stateLook(member.state);
	const ring = look.tone === "muted" ? undefined : TONES[look.tone];
	return (
		<li
			className="mete-card"
			aria-label={name}
			style={{ ...ROW, ...(ring ? { borderColor: ring } : {}) }}
		>
			<span aria-hidden="true" style={AVATAR}>
				{name.charAt(0).toUpperCase()}
			</span>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "3px",
					minWidth: 0,
				}}
			>
				<div style={LINE}>
					<strong style={{ fontSize: "1.1em" }}>{name}</strong>
					{member.agent?.tier ? <TierChip tier={member.agent.tier} /> : null}
				</div>
				<Model member={member} />
				<Context member={member} windows={windows} />
				{member.now ? <Now now={member.now} /> : null}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					gap: "4px",
				}}
			>
				<span
					className="mete-chip"
					style={{ ...PILL, color: TONES[look.tone] }}
				>
					<Icon name={look.icon} {...(look.spin ? { spin: true } : {})} />
					{look.text}
				</span>
				{member.total > 0 ? (
					<span style={{ ...PILL, ...MUTED }}>
						<Icon name="checklist" />
						{nls.localize(
							"mete/roster/tasks",
							"{0} of {1} tasks done",
							member.done,
							member.total,
						)}
					</span>
				) : null}
			</div>
		</li>
	);
};

const count = (
	members: readonly Member[],
	kinds: readonly MemberState["kind"][],
) => members.filter((m) => kinds.includes(m.state.kind)).length;

// The run's tokens, the sum over its members, once any call has reported usage (ADR-090).
const RunTokens = ({ members }: { readonly members: readonly Member[] }) => {
	const used = members.flatMap((m) => (m.used ? [m.used] : []));
	if (used.length === 0) return null;
	return (
		<>
			{" · "}
			{nls.localize(
				"mete/roster/runTokens",
				"run tokens: {0} · calls: {1}",
				tokenCount(used.reduce((n, u) => n + u.tokens, 0)),
				used.reduce((n, u) => n + u.calls, 0),
			)}
		</>
	);
};

const Summary = ({ members }: { readonly members: readonly Member[] }) => (
	<p style={MUTED}>
		{nls.localize(
			"mete/roster/summary",
			"Members: {0} · working: {1} · waiting for you: {2} · done: {3}",
			members.length,
			count(members, ["working", "thinking"]),
			count(members, ["waits_for_you"]),
			count(members, ["done"]),
		)}
		<RunTokens members={members} />
	</p>
);

/** The Team view: the run's members, each named as the team file names it or else by its id in words. */
export const TeamView = ({
	members,
	names,
	windows,
}: {
	readonly members: readonly Member[];
	readonly names: Readonly<Record<string, string>>;
	readonly windows: Windows;
}) => (
	<section
		aria-label={nls.localize("mete/roster/title", "Team")}
		style={{ maxWidth: "960px" }}
	>
		<Summary members={members} />
		<ul style={LIST}>
			{members.map((m) => (
				<Row
					key={m.roleId}
					member={m}
					name={names[m.roleId] ?? roleWords(m.roleId)}
					windows={windows}
				/>
			))}
		</ul>
	</section>
);
