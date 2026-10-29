import { type AllowScope, canAlways, type PolicyAsk } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { Icon } from "./roster-look.js";
import { Card } from "./wait-card.js";

// The Waiting for you card of a run paused for approval with no task asking the human (ADR-121):
// what the policy asks, if it asked, and the allow buttons, or Resume.

const askTarget = (ask: PolicyAsk) => ask.command ?? ask.path ?? ask.capability;

// What the policy asks about, in JetBrains Mono on a raised line, its whole text in the tooltip.
const AskLine = ({ ask }: { readonly ask: PolicyAsk }) => (
	<div
		className="mete-wait-ask"
		title={`asks ${ask.action}: ${askTarget(ask)}`}
	>
		<span className="mete-tile" aria-hidden="true">
			<Icon name="terminal" />
		</span>
		<code>
			<span className="mete-wait-ask-verb">asks</span>{" "}
			<span className="mete-wait-ask-action">{ask.action}</span>:{" "}
			{askTarget(ask)}
		</code>
	</div>
);

export const askKey = (ask?: PolicyAsk) =>
	ask ? `${ask.action}:${ask.command ?? ask.path ?? ask.capability}` : "none";

/** The action buttons of the run wait card: three allow buttons or Resume (ADR-121). */
export const AllowActions = ({
	asked,
	onAct,
	onResume,
}: {
	readonly asked?: PolicyAsk | undefined;
	readonly onAct: (scope: AllowScope) => void;
	readonly onResume: () => void;
}) => (
	<div className="mete-wait-actions">
		{asked ? (
			<>
				<button
					type="button"
					className="mete-button"
					onClick={() => onAct("once")}
				>
					<Icon name="check" />
					{nls.localize("mete/waiting/allowOnce", "Allow once")}
				</button>
				<button
					type="button"
					className="mete-button quiet"
					onClick={() => onAct("run")}
				>
					<Icon name="check-all" />
					{nls.localize("mete/waiting/allowRun", "Allow for this run")}
				</button>
				{canAlways(asked) ? (
					<button
						type="button"
						className="mete-button quiet"
						onClick={() => onAct("always")}
					>
						<Icon name="shield" />
						{nls.localize("mete/waiting/allowAlways", "Always allow")}
					</button>
				) : null}
			</>
		) : (
			<button type="button" className="mete-button" onClick={onResume}>
				<Icon name="debug-continue" />
				{nls.localize("mete/home/resume", "Resume")}
			</button>
		)}
	</div>
);

// Paused for approval with no task asking the human: a policy ask, or a merge to settle (ADR-121).
export const RunWaits = ({
	asked,
	onResume,
	onAllow,
	initialError,
}: {
	readonly asked?: PolicyAsk | undefined;
	readonly onResume: () => void;
	readonly onAllow?:
		| ((scope: AllowScope) => Promise<string | undefined>)
		| undefined;
	readonly initialError?: string | undefined;
}) => {
	const [error, setError] = useState<string | undefined>(initialError);
	const act = async (scope: AllowScope) => {
		setError(undefined);
		const failed = await onAllow?.(scope);
		if (failed) setError(failed);
	};
	return (
		<Card
			tone="warn"
			icon="debug-pause"
			title={nls.localize("mete/waiting/run", "The run waits for you.")}
		>
			{asked ? (
				<>
					<AskLine ask={asked} />
					{/* The hint names the allow buttons; without an ask the card keeps Resume (ADR-121). */}
					<p className="mete-wait-note">
						{nls.localize(
							"mete/waiting/allowHint",
							"Allow the action once, for the rest of this run, or always in .mete/policy.yaml.",
						)}
					</p>
				</>
			) : null}
			{error ? (
				<p
					className="mete-wait-note"
					style={{ color: "var(--theia-errorForeground)" }}
				>
					{error}
				</p>
			) : null}
			<AllowActions
				asked={asked}
				onAct={(s) => void act(s)}
				onResume={onResume}
			/>
		</Card>
	);
};
