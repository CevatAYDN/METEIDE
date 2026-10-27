import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { type Member, roleWords, rosterOf } from "../domain/roster.js";
import { Icon } from "./roster-look.js";
import { type Hero, heroOf, type RunFacts } from "./run-hero.js";
import { stateLook } from "./team-view.js";
import { TONES, type Tone } from "./tone.js";

// The Team panel's hero band (ADR-094, ADR-127): the run's status as a wash pill over its goal, the
// meta line, the number tiles, and in a team run the ring of its approved tasks beside one initial
// tile per member. The look lives in style/mete-components.css; a tone is passed as `--tone`.

const toned = (tone: Tone): CSSProperties => ({
	["--tone" as string]: TONES[tone],
});

// The ring's circumference for its radius of 31 in a 76 wide box.
const ROUND = 2 * Math.PI * 31;

const Ring = ({
	done,
	total,
}: {
	readonly done: number;
	readonly total: number;
}) => (
	<div
		className="mete-ring"
		role="img"
		aria-label={nls.localize(
			"mete/strip/progress",
			"{0} of {1} tasks done",
			done,
			total,
		)}
	>
		<svg viewBox="0 0 76 76" aria-hidden="true">
			<circle cx="38" cy="38" r="31" />
			<circle
				cx="38"
				cy="38"
				r="31"
				className="mete-ring-done"
				strokeDasharray={`${(done / total) * ROUND} ${ROUND}`}
				transform="rotate(-90 38 38)"
			/>
		</svg>
		<span className="mete-ring-label" aria-hidden="true">
			<span className="mete-mono">
				{done}/{total}
			</span>
			<span>{nls.localize("mete/strip/tasks", "tasks")}</span>
		</span>
	</div>
);

// A role's initial in a ring of its state's tone, with the state's icon in the corner but for idle.
const MemberTile = ({
	member,
	name,
}: {
	readonly member: Member;
	readonly name: string;
}) => {
	const look = stateLook(member.state);
	return (
		<li
			className="mete-member"
			data-state={member.state.kind}
			style={toned(look.tone)}
		>
			<span className="mete-avatar">
				<span className="mete-avatar-face">{name.charAt(0).toUpperCase()}</span>
				{member.state.kind === "idle" ? null : (
					<span className="mete-avatar-badge">
						<Icon name={look.icon} {...(look.spin ? { spin: true } : {})} />
					</span>
				)}
			</span>
			<span className="mete-member-name">{name}</span>
			<span className="mete-member-state">{look.text}</span>
		</li>
	);
};

const Glance = ({
	progress,
	view,
	names,
}: {
	readonly progress: NonNullable<Hero["progress"]>;
	readonly view: TeamView;
	readonly names: Readonly<Record<string, string>>;
}) => (
	<section
		className="mete-glance"
		aria-label={nls.localize("mete/strip/glance", "Team at a glance")}
	>
		<Ring done={progress.done} total={progress.total} />
		<ul className="mete-members">
			{rosterOf(view).map((m) => (
				<MemberTile
					key={m.roleId}
					member={m}
					name={names[m.roleId] ?? roleWords(m.roleId)}
				/>
			))}
		</ul>
	</section>
);

const Main = ({
	goal,
	hero,
}: {
	readonly goal: string;
	readonly hero: Hero;
}) => (
	<div className="mete-hero-main">
		{hero.status ? (
			<span
				role="status"
				className="mete-pill"
				data-status={hero.status.status}
				style={toned(hero.status.tone)}
			>
				{hero.status.word}
			</span>
		) : null}
		<h2 className="mete-hero-goal" title={goal}>
			{goal}
		</h2>
		{hero.facts.length > 0 ? (
			<p className="mete-hero-facts">
				{hero.facts.map((f) => (
					<span key={f.key} {...(f.title ? { title: f.title } : {})}>
						{f.text}
					</span>
				))}
			</p>
		) : null}
		<dl className="mete-tiles">
			{hero.tiles.map((t) => (
				<div key={t.key}>
					<dt>{t.caption}</dt>
					<dd className="mete-mono">{t.value}</dd>
				</div>
			))}
		</dl>
	</div>
);

/** The hero band of the shown run, above every view. */
export const RunHero = ({
	goal,
	facts,
	view,
	names,
}: {
	readonly goal: string;
	readonly facts: RunFacts;
	readonly view: TeamView;
	readonly names: Readonly<Record<string, string>>;
}) => {
	const hero = heroOf(facts, view);
	return (
		<header className="mete-hero">
			<Main goal={goal} hero={hero} />
			{hero.progress ? (
				<Glance progress={hero.progress} view={view} names={names} />
			) : null}
		</header>
	);
};
