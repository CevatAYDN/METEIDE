import { TEMPLATE_DEFAULTS } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import { Chips, Count, type OnEdit, orNone, Text, Tick } from "./fields.js";
import {
	runsOf,
	type TeamView,
	type WorkView,
	withRuns,
} from "./team-draft.js";
import { TierTiles } from "./tier-tiles.js";

// What the team editor asks of the work (docs/08, Task fields; ADR-075): a task's or a member's
// spawn defaults' output, approver, whom it asks before starting (ADR-142), pair reviewer (ADR-136),
// verify commands, guardrail, lesson (ADR-145) and attempts (ADR-162), and the team's revision limit and budget. Only what core honors is
// shown: capability gates are not yet; a pair's max_turns stays in the YAML.
// The fields sit in the grid of `.mete-task-grid` (style/mete-team-form.css).

type Path = readonly (string | number)[];

/** The output, approver, commands and guardrail of a task or of spawn defaults at `base`. */
export const Work = (props: {
	readonly team: TeamView;
	readonly work: WorkView;
	readonly base: Path;
	readonly hints: readonly string[];
	readonly onEdit: OnEdit;
}) => {
	const { team, work, base, onEdit } = props;
	const at = (...key: string[]) => [...base, ...key];
	return (
		<>
			<Text
				label={nls.localize(
					"mete/team/output",
					"Expected output (artifact:<type>@<version>, optional)",
				)}
				value={work.expected_output ?? ""}
				mono
				onChange={(v) => onEdit(at("expected_output"), orNone(v))}
			/>
			<label>
				{nls.localize("mete/team/approval", "Approved by")}
				<select
					className="mete-field"
					value={work.approval ?? ""}
					onChange={(e) => onEdit(at("approval"), orNone(e.target.value))}
				>
					<option value="">
						{nls.localize("mete/team/noApproval", "No approval")}
					</option>
					<option value="human">
						{nls.localize("mete/team/human", "You")}
					</option>
					{team.roles.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name || r.id}
						</option>
					))}
				</select>
			</label>
			<Clarify {...props} />
			<Pair {...props} />
			<Chips
				label={nls.localize(
					"mete/team/verify",
					"Commands that must pass before it is submitted (such as npm test)",
				)}
				values={runsOf(work.verify)}
				hints={[]}
				onChange={(v) => onEdit(at("verify"), withRuns(work.verify, v))}
			/>
			<Guardrail {...props} />
			<Lesson {...props} />
			<Attempts {...props} />
		</>
	);
};

/**
 * The edit a new attempts count makes (ADR-162): below 2 the key goes, since n of 1 is the path of
 * today; the first count of 2 or more writes the whole object the schema needs, after that the count.
 */
export const attemptsEdit = (
	current: WorkView["attempts"],
	n: number | undefined,
): { readonly key: readonly string[]; readonly value: unknown } => {
	if (n === undefined || n < 2) return { key: [], value: undefined };
	if (current) return { key: ["n"], value: n };
	// reasoning is the editor's starting value, not a template default: docs/08 names none.
	const value = { n, distinct_families: false, judge_tier: "reasoning" };
	return { key: [], value };
};

// Best-of-N (ADR-162): how many times the work is tried; the family tick and the judge's tier show
// only once there are 2 or more attempts, since below that they do nothing.
const Attempts = ({
	work,
	base,
	onEdit,
}: {
	readonly work: WorkView;
	readonly base: Path;
	readonly onEdit: OnEdit;
}) => {
	const a = work.attempts;
	const at = [...base, "attempts"];
	return (
		<div className="mete-attempts">
			<Count
				label={nls.localize("mete/team/attempts", "Attempts")}
				value={a?.n}
				fallback={1}
				onChange={(n) => {
					const { key, value } = attemptsEdit(a, n);
					onEdit([...at, ...key], value);
				}}
			/>
			<p>
				{nls.localize(
					"mete/team/attemptsHint",
					"Tries the task up to this many times; its checks, then a judge, keep one. Each attempt is one more task's worth of requests, plus one for the judge.",
				)}
			</p>
			{a ? (
				<>
					<Tick
						label={nls.localize(
							"mete/team/attemptsFamilies",
							"Each attempt after the first uses another model family",
						)}
						checked={a.distinct_families}
						onChange={(c) => onEdit([...at, "distinct_families"], c)}
					/>
					<TierTiles
						legend={nls.localize("mete/team/judgeTier", "Judge's model tier")}
						hint={null}
						value={a.judge_tier}
						onEdit={(v) => onEdit([...at, "judge_tier"], v)}
					/>
				</>
			) : null}
		</div>
	);
};

// After approval the task's agent writes one lesson to the vault, a cloud request more (ADR-145).
const Lesson = ({
	work,
	base,
	onEdit,
}: {
	readonly work: WorkView;
	readonly base: Path;
	readonly onEdit: OnEdit;
}) => (
	<Tick
		label={nls.localize(
			"mete/team/lessons",
			"Writes a lesson to the vault after approval (one request more)",
		)}
		checked={work.memory?.write_lessons === true}
		onChange={(c) =>
			onEdit([...base, "memory"], c ? { write_lessons: true } : undefined)
		}
	/>
);

// Whom the task asks its questions before it works: a member, or the human (ADR-142).
const Clarify = ({
	team,
	work,
	base,
	onEdit,
}: {
	readonly team: TeamView;
	readonly work: WorkView;
	readonly base: Path;
	readonly onEdit: OnEdit;
}) => (
	<label>
		{nls.localize("mete/team/clarify", "Asks before starting (optional)")}
		<select
			className="mete-field"
			value={work.before_start?.clarify_with ?? ""}
			onChange={(e) =>
				e.target.value
					? onEdit([...base, "before_start", "clarify_with"], e.target.value)
					: onEdit([...base, "before_start"], undefined)
			}
		>
			<option value="">
				{nls.localize("mete/team/noClarify", "Asks no one")}
			</option>
			<option value="human">{nls.localize("mete/team/human", "You")}</option>
			{team.roles.map((r) => (
				<option key={r.id} value={r.id}>
					{r.name || r.id}
				</option>
			))}
		</select>
	</label>
);

// The pair reviewer: a member who reviews each submission before the approver (ADR-136).
const Pair = ({
	team,
	work,
	base,
	onEdit,
}: {
	readonly team: TeamView;
	readonly work: WorkView;
	readonly base: Path;
	readonly onEdit: OnEdit;
}) => (
	<label>
		{nls.localize("mete/team/pair", "Reviewed first by (optional)")}
		<select
			className="mete-field"
			value={work.review?.pair_with ?? ""}
			onChange={(e) =>
				e.target.value
					? onEdit([...base, "review", "pair_with"], e.target.value)
					: onEdit([...base, "review"], undefined)
			}
		>
			<option value="">
				{nls.localize("mete/team/noPair", "No pair review")}
			</option>
			{team.roles.map((r) => (
				<option key={r.id} value={r.id}>
					{r.name || r.id}
				</option>
			))}
		</select>
	</label>
);

// The guardrail: the report must be JSON of an artifact type, repaired at most max_retries times.
const Guardrail = (props: {
	readonly work: WorkView;
	readonly base: Path;
	readonly hints: readonly string[];
	readonly onEdit: OnEdit;
}) => {
	const { work, base, onEdit } = props;
	const schema = work.guardrail?.schema ?? "";
	const list = useId();
	return (
		<div className="mete-guardrail">
			<label>
				{nls.localize(
					"mete/team/guardrail",
					"Report checked as (artifact type such as gdd@1, optional)",
				)}
				<input
					className="mete-field mono"
					list={list}
					value={schema}
					onChange={(e) =>
						e.target.value.trim()
							? onEdit([...base, "guardrail", "schema"], e.target.value)
							: onEdit([...base, "guardrail"], undefined)
					}
				/>
				<datalist id={list}>
					{props.hints.map((h) => (
						<option key={h} value={h} />
					))}
				</datalist>
			</label>
			<Count
				label={nls.localize("mete/team/repairs", "Repairs")}
				value={work.guardrail?.max_retries}
				fallback={TEMPLATE_DEFAULTS.guardrailMaxRetries}
				disabled={!schema}
				onChange={(v) => onEdit([...base, "guardrail", "max_retries"], v)}
			/>
		</div>
	);
};

/** The team's revision limit and budget: three tiles over the note that a team never raises the policy's limit. */
export const TeamRules = ({
	team,
	onEdit,
}: {
	readonly team: TeamView;
	readonly onEdit: OnEdit;
}) => (
	<section className="mete-team-limits">
		<div>
			<Count
				label={nls.localize("mete/team/revisionLimit", "Revisions per task")}
				value={team.policies.revision_limit}
				fallback={TEMPLATE_DEFAULTS.revisionLimit}
				onChange={(v) => onEdit(["policies", "revision_limit"], v)}
			/>
			<Count
				label={nls.localize("mete/team/requests", "Cloud requests per run")}
				value={team.budget.cloud_requests}
				fallback={TEMPLATE_DEFAULTS.cloudRequests}
				onChange={(v) => onEdit(["budget", "cloud_requests"], v)}
			/>
			<Count
				label={nls.localize("mete/team/hours", "Hours per run")}
				value={team.budget.max_hours}
				fallback={TEMPLATE_DEFAULTS.maxHours}
				onChange={(v) => onEdit(["budget", "max_hours"], v)}
			/>
		</div>
		<p>
			{nls.localize(
				"mete/team/budgetHint",
				"A run stops at the lower of this budget and your policy's, so a team never raises your limit.",
			)}
		</p>
	</section>
);
