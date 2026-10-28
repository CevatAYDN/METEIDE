import { TEMPLATE_DEFAULTS } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import { Chips, Count, type OnEdit, orNone, Text } from "./fields.js";
import {
	runsOf,
	type TeamView,
	type WorkView,
	withRuns,
} from "./team-draft.js";

// What the team editor asks of the work (docs/08, Task fields; ADR-075): a task's or a member's
// spawn defaults' output, approver, whom it asks before starting (ADR-142), pair reviewer (ADR-136),
// verify commands and guardrail, and the team's revision limit and budget. Only what core honors is
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
		</>
	);
};

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
