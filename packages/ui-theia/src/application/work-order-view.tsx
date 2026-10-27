import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import { Icon } from "./roster-look.js";
import type { TeamView } from "./team-draft.js";
import { orderOfWork, type Step } from "./work-order.js";

// Order of work (ADR-093): the team's tasks in the order a run can start them, read-only. A row
// selects its member; what a task waits for is edited in the member's form. Laid out by
// style/mete-team-members.css.

const approvedBy = (s: Step): string | undefined => {
	if (!s.approver) return undefined;
	if (s.approver.kind === "human")
		return nls.localize("mete/team/orderYou", "you approve it");
	return s.checkpoint
		? nls.localize(
				"mete/team/orderThenYou",
				"approved by {0}, then by you",
				s.approver.name,
			)
		: nls.localize(
				"mete/team/orderApprover",
				"approved by {0}",
				s.approver.name,
			);
};

const StepRow = (props: {
	readonly step: Step;
	readonly number: number;
	readonly onSelect: (member: number) => void;
}) => {
	const { step } = props;
	const notes = [
		step.after.length > 0
			? nls.localize("mete/team/orderAfter", "after {0}", step.after.join(", "))
			: undefined,
		approvedBy(step),
	].filter((n) => n !== undefined);
	return (
		<li>
			<button
				type="button"
				className="mete-step"
				disabled={step.member < 0}
				onClick={() => props.onSelect(step.member)}
			>
				<span className="mete-step-n">{props.number}</span>
				<span className="mete-step-text">
					<strong>{step.title}</strong>
					<span className="mete-step-by">
						{step.memberName}
						{notes.length > 0 ? (
							<span className="mete-step-notes">{` · ${notes.join(" · ")}`}</span>
						) : null}
					</span>
				</span>
			</button>
		</li>
	);
};

/** The tasks in the order they can start, or nothing when the team has none. */
export const OrderOfWork = (props: {
	readonly team: TeamView;
	readonly onSelect: (member: number) => void;
}) => {
	const title = useId();
	const steps = orderOfWork(props.team);
	if (steps.length === 0) return null;
	return (
		<section className="mete-order" aria-labelledby={title}>
			<h3 id={title}>
				<Icon name="list-ordered" />
				{nls.localize("mete/team/order", "Order of work")}
			</h3>
			<p>
				{nls.localize(
					"mete/team/orderHint",
					"Each task starts when the tasks it waits for are done.",
				)}
			</p>
			<ol>
				{steps.map((s, i) => (
					<StepRow
						// biome-ignore lint/suspicious/noArrayIndexKey: two new tasks may share a title until the schema refuses it
						key={i}
						step={s}
						number={i + 1}
						onSelect={props.onSelect}
					/>
				))}
			</ol>
		</section>
	);
};
