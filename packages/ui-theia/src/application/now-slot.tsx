import type { AgentCard, TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import {
	type Member,
	type MemberState,
	roleWords,
	rosterOf,
} from "../domain/roster.js";
import { Avatar } from "./avatar.js";
import {
	type Share,
	ShareBar,
	shareOf,
	type Windows,
} from "./context-meter.js";
import { stepOf } from "./flow-graph.js";
import { stateLook } from "./member-look.js";
import { elapsedText } from "./time-text.js";
import { type WaitingControls, WaitingStrip } from "./waiting-strip.js";

// The Now slot (ADR-127): under the hero band, the one thing that matters now. The Waiting for you
// cards when the human is asked (ADR-091); otherwise the member whose model or tool call is in
// flight, with its model, its seconds or its tool's progress (ADR-125, ADR-067) and its context share
// (ADR-090); otherwise nothing. Team and single-agent runs share it. Look: style/mete-now.css.

type Busy = Member & { readonly agent: AgentCard };

const busyOf = (view: TeamView): Busy | undefined =>
	rosterOf(view).find(
		(m): m is Busy =>
			m.agent !== undefined &&
			(m.state.kind === "thinking" || m.state.kind === "working"),
	);

// The seconds of a model call, counted as the steps count them; a tool call in the roster's words.
const doingText = (state: MemberState) =>
	state.kind === "thinking" && state.since
		? nls.localize(
				"mete/steps/thinking",
				"Thinking… {0}",
				elapsedText(state.since),
			)
		: stateLook(state).text;

// The words say the share; the bar under them only shows it.
const ContextMeter = ({ share }: { readonly share: Share }) => (
	<div className="mete-now-context">
		<span>{share.text}</span>
		<ShareBar share={share} width="100%" />
	</div>
);

const BusyCard = ({
	member,
	name,
	windows,
}: {
	readonly member: Busy;
	readonly name: string;
	readonly windows: Windows;
}) => {
	const { agent } = member;
	const share = shareOf(member, windows);
	return (
		<section
			className="mete-now"
			aria-label={nls.localize("mete/board/now", "Now")}
		>
			<Avatar name={name} state={member.state} />
			<div className="mete-now-body">
				<p className="mete-now-title">
					<span>{name}</span>
					<span className="mete-now-doing">{doingText(member.state)}</span>
					{agent.progress ? (
						<span className="mete-mono">{stepOf(agent.progress)}</span>
					) : null}
				</p>
				<p className="mete-now-model mete-mono">
					{agent.providerId} · {agent.modelId}
				</p>
			</div>
			{share ? <ContextMeter share={share} /> : null}
		</section>
	);
};

/** What the run needs from the user, or what it is doing, now; nothing while it rests. */
export const NowSlot = ({
	view,
	names,
	windows,
	waiting,
}: {
	readonly view: TeamView;
	readonly names: Readonly<Record<string, string>>;
	readonly windows: Windows;
	readonly waiting: WaitingControls;
}) => {
	if (view.signals.pausedFor === "approval")
		return <WaitingStrip view={view} names={names} controls={waiting} />;
	const busy = busyOf(view);
	if (!busy) return null;
	return (
		<BusyCard
			member={busy}
			name={names[busy.roleId] ?? roleWords(busy.roleId)}
			windows={windows}
		/>
	);
};
