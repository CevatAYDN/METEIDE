import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import {
	waitsForBudget,
	waitsForQuota,
	waitsForUser,
} from "../domain/home-model.js";
import { type Member, roleWords, rosterOf } from "../domain/roster.js";
import { Avatar } from "./avatar.js";
import { stateLook } from "./member-look.js";
import { Icon } from "./roster-look.js";
import { type Hero, heroOf, type RunEntry, type RunFacts } from "./run-hero.js";
import { type PausedFor, PausedRun } from "./runs-list.js";
import { toneStyle } from "./tone.js";

// The Team panel's hero band (ADR-094, ADR-127): the run's status as a wash pill over its goal, the
// meta line, the number tiles, and in a team run the ring of its approved tasks beside one initial
// tile per member. A run paused for quota, by the user or for its budget shows under its status what
// its side-bar row shows (docs/13). The look lives in style/mete-hero.css; a tone is passed as `--tone`.

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

const MemberTile = ({
	member,
	name,
}: {
	readonly member: Member;
	readonly name: string;
}) => (
	<li className="mete-member" data-state={member.state.kind}>
		<Avatar name={name} state={member.state} />
		<span className="mete-member-name">{name}</span>
		<span className="mete-member-state">{stateLook(member.state).text}</span>
	</li>
);

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

// A settled status wears its glyph (ADR-128); a queued or running one keeps the dot of mete-hero.css.
const GLYPH: Partial<Record<NonNullable<Hero["status"]>["status"], string>> = {
	paused: "debug-pause",
	completed: "check",
	failed: "error",
	cancelled: "circle-slash",
};

const Pill = ({ status }: { readonly status: NonNullable<Hero["status"]> }) => {
	const glyph = GLYPH[status.status];
	return (
		<span
			role="status"
			className="mete-pill"
			data-status={status.status}
			style={toneStyle(status.tone)}
		>
			{glyph ? <Icon name={glyph} /> : null}
			{status.word}
		</span>
	);
};

// A team run's tiles sit under the meta line, a single agent's at the band's right (ADR-128).
const Tiles = ({ tiles }: { readonly tiles: Hero["tiles"] }) => (
	<dl className="mete-tiles">
		{tiles.map((t) => (
			<div key={t.key}>
				<dt>{t.caption}</dt>
				<dd
					className="mete-mono"
					{...(t.value === "0" ? { "data-zero": "" } : {})}
				>
					{t.value}
				</dd>
			</div>
		))}
	</dl>
);

const pausedFor = (run: RunEntry | undefined): PausedFor | undefined => {
	if (!run) return undefined;
	if (waitsForQuota(run)) return "quota";
	if (waitsForUser(run)) return "user";
	return waitsForBudget(run) ? "budget" : undefined;
};

const Main = ({
	goal,
	hero,
	paused,
}: {
	readonly goal: string;
	readonly hero: Hero;
	readonly paused: ReactNode;
}) => (
	<div className="mete-hero-main">
		{hero.status ? <Pill status={hero.status} /> : null}
		{paused}
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
		{hero.progress ? <Tiles tiles={hero.tiles} /> : null}
	</div>
);

/** The hero band of the shown run, above every view. */
export const RunHero = ({
	goal,
	facts,
	view,
	names,
	onResume,
}: {
	readonly goal: string;
	readonly facts: RunFacts;
	readonly view: TeamView;
	readonly names: Readonly<Record<string, string>>;
	readonly onResume: () => void;
}) => {
	const hero = heroOf(facts, view);
	const reason = pausedFor(facts.run);
	const paused = reason ? (
		<div className="mete-hero-paused">
			<PausedRun
				reason={reason}
				blocked={facts.blocked ?? []}
				onResume={onResume}
			/>
		</div>
	) : null;
	return (
		<header className="mete-hero">
			<Main goal={goal} hero={hero} paused={paused} />
			{hero.progress ? (
				<Glance progress={hero.progress} view={view} names={names} />
			) : (
				<Tiles tiles={hero.tiles} />
			)}
		</header>
	);
};
