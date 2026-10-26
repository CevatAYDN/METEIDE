import { type Place, placeOf, type TaskCard } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { roleWords } from "../domain/roster.js";
import { LIST, MUTED } from "./look.js";
import { Icon } from "./roster-look.js";
import { placeWord } from "./task-words.js";

// The rail's Tasks tab (ADR-119): every task of the run, in the order the team file lists them,
// with where it stands and its member, as the side view's two-line rows with a tile (ADR-109).

type Look = { readonly icon: string; readonly tone?: string };

const LOOKS: Readonly<
	Record<Place["column"] | NonNullable<Place["marker"]>, Look>
> = {
	todo: { icon: "circle-outline" },
	in_progress: { icon: "sync", tone: "accent" },
	done: { icon: "pass", tone: "good" },
	in_review: { icon: "eye", tone: "accent" },
	changes_asked: { icon: "comment", tone: "warn" },
	blocked: { icon: "error", tone: "bad" },
};

const Row = ({
	task,
	member,
}: {
	readonly task: TaskCard;
	readonly member: string;
}) => {
	const place = placeOf(task.status);
	const look = LOOKS[place.marker ?? place.column];
	return (
		<li className="mete-item">
			<span
				className={`mete-tile${look.tone ? ` ${look.tone}` : ""}`}
				aria-hidden="true"
			>
				<Icon name={look.icon} />
			</span>
			<span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
				<span className="mete-title" title={task.title}>
					{task.title}
				</span>
				<span className="mete-sub">
					{placeWord(place)} · {member}
				</span>
			</span>
		</li>
	);
};

export const RailTasks = ({
	tasks,
	names,
}: {
	readonly tasks: readonly TaskCard[];
	readonly names: Readonly<Record<string, string>>;
}) =>
	tasks.length === 0 ? (
		<p style={{ ...MUTED, margin: 0 }}>
			{nls.localize(
				"mete/board/noTasks",
				"This run has no tasks: a single agent works without a board.",
			)}
		</p>
	) : (
		<ul style={{ ...LIST, margin: 0 }}>
			{tasks.map((t) => (
				<Row
					key={t.id}
					task={t}
					member={names[t.roleId] ?? roleWords(t.roleId)}
				/>
			))}
		</ul>
	);
