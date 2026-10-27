import type { ModelRef, Tier } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { type Member, type MemberState, roleWords } from "../domain/roster.js";
import { Avatar } from "./avatar.js";
import { Context, type Windows } from "./context-meter.js";
import { stateLook, TIER_ICONS, tierLabel } from "./member-look.js";
import { Icon } from "./roster-look.js";
import {
	commitModel,
	ModelChoice,
	ModelChoiceField,
	ModelChoiceInput,
	type ModelChoiceProps,
	RevertButton,
} from "./team-model-choice.js";
import { toneStyle } from "./tone.js";

export {
	commitModel,
	ModelChoice,
	ModelChoiceField,
	ModelChoiceInput,
	type ModelChoiceProps,
	RevertButton,
};

// The Team panel's fourth view (ADR-089): one row per role with its tier, model, state and what it
// does now. Icons are Theia's codicons; each state is an icon and a word, never a colour alone.

// A row is the design set's member card (ADR-128): the initial tile, the name with its tier and model,
// and the state with the tasks done at its head; under them a strip of what it does now, its context
// and the run's model choice. The look lives in style/mete-roster.css; the state's tone is `--tone`.

const Now = ({ now }: { readonly now: NonNullable<Member["now"]> }) => (
	<div className="mete-roster-now">
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
		<p className="mete-roster-model mete-mono">
			<Icon name="circuit-board" />
			{member.agent.providerId} ·{" "}
			{/* Some providers' model ids start with the provider's own name. */}
			{member.agent.modelId.replace(`${member.agent.providerId}/`, "")}
		</p>
	) : null;

const TierChip = ({ tier }: { readonly tier: Tier }) => (
	<span className="mete-roster-tier" title={tier}>
		<Icon name={TIER_ICONS[tier]} />
		{tierLabel(tier)}
		<span className="mete-mono">{tier}</span>
	</span>
);

type MemberRowProps = {
	readonly member: Member;
	readonly name: string;
	readonly windows: Windows;
	readonly models: readonly string[];
	readonly value?: string | undefined;
	readonly onModel?:
		| ((roleId: string, model: ModelRef | null) => void)
		| undefined;
};

const State = ({ member }: { readonly member: Member }) => {
	const look = stateLook(member.state);
	return (
		<div className="mete-roster-state">
			<span className="mete-roster-pill">
				<Icon name={look.icon} {...(look.spin ? { spin: true } : {})} />
				{look.text}
			</span>
			{member.total > 0 ? (
				<span className="mete-roster-done">
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
	);
};

const Head = ({
	member,
	name,
}: {
	readonly member: Member;
	readonly name: string;
}) => (
	<div className="mete-roster-head">
		<Avatar name={name} state={member.state} />
		<div className="mete-roster-who">
			<div className="mete-roster-name">
				<h3>{name}</h3>
				{member.agent?.tier ? <TierChip tier={member.agent.tier} /> : null}
			</div>
			<Model member={member} />
		</div>
		<State member={member} />
	</div>
);

// The strip under the head: what the member does now, its context and tokens (ADR-090) and the run's
// model choice (ADR-122); none while it has none of them.
const Strip = ({ member, windows, models, value, onModel }: MemberRowProps) =>
	member.now || member.used || onModel ? (
		<div className="mete-roster-strip">
			{member.now ? <Now now={member.now} /> : null}
			<Context member={member} windows={windows} />
			{onModel ? (
				<ModelChoice
					roleId={member.roleId}
					value={value}
					models={models}
					onModel={onModel}
				/>
			) : null}
		</div>
	) : null;

const Row = (props: MemberRowProps) => (
	<li
		className="mete-roster-row"
		aria-label={props.name}
		data-state={props.member.state.kind}
		style={toneStyle(stateLook(props.member.state).tone)}
	>
		<Head member={props.member} name={props.name} />
		<Strip {...props} />
	</li>
);

const count = (
	members: readonly Member[],
	kinds: readonly MemberState["kind"][],
) => members.filter((m) => kinds.includes(m.state.kind)).length;

const Summary = ({ members }: { readonly members: readonly Member[] }) => (
	<p className="mete-roster-summary">
		{nls.localize(
			"mete/roster/summary",
			"Members: {0} · working: {1} · waiting for you: {2} · done: {3}",
			members.length,
			count(members, ["working", "thinking"]),
			count(members, ["waits_for_you"]),
			count(members, ["done"]),
		)}
	</p>
);

export type TeamViewProps = {
	readonly members: readonly Member[];
	readonly names: Readonly<Record<string, string>>;
	readonly windows: Windows;
	readonly candidateModels?:
		| Readonly<Record<string, readonly string[]>>
		| undefined;
	readonly preferredModels?: Readonly<Record<string, string>> | undefined;
	readonly onModel?:
		| ((roleId: string, model: ModelRef | null) => void)
		| undefined;
};

/** The Team view: the run's members, each named as the team file names it or else by its id in words. */
export const TeamView = ({
	members,
	names,
	windows,
	candidateModels,
	preferredModels,
	onModel,
}: TeamViewProps) => (
	<section
		className="mete-roster"
		aria-label={nls.localize("mete/roster/title", "Team")}
	>
		<Summary members={members} />
		<ul>
			{members.map((m) => (
				<Row
					key={m.roleId}
					member={m}
					name={names[m.roleId] ?? roleWords(m.roleId)}
					windows={windows}
					models={
						candidateModels?.[m.roleId] ??
						(m.agent?.tier ? candidateModels?.[m.agent.tier] : undefined) ??
						[]
					}
					value={preferredModels?.[m.roleId]}
					onModel={onModel}
				/>
			))}
		</ul>
	</section>
);
