import type { TranscriptStep } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { MUTED, TITLE } from "./look.js";
import { MarkdownView } from "./markdown-view.js";
import { Icon } from "./roster-look.js";
import { failureText } from "./status-text.js";
import { StepList } from "./step-list.js";
import type { TranscriptState } from "./transcript-session.js";

// A single-agent run in the Team panel's center (docs/13, ADR-125): no board, but the agent's steps
// as it works and the call in flight with its seconds; the center puts its answer above them.

// The answer is the agent's last reply, so that reply is not shown twice.
const withoutAnswer = (
	steps: readonly TranscriptStep[],
	answer: string | undefined,
) => {
	const last = steps.at(-1);
	return answer && last?.text === answer && last.toolCalls.length === 0
		? steps.slice(0, -1)
		: steps;
};

/** A finished single agent's answer, leading the center above its steps (ADR-127). */
export const Answer = ({
	text,
	markdown,
}: {
	readonly text: string;
	readonly markdown: MarkdownRenderer;
}) => (
	<section
		className="mete-answer"
		aria-label={nls.localize("mete/board/answer", "Answer")}
	>
		<header>
			<span className="mete-answer-icon">
				<Icon name="comment" />
			</span>
			<h3>{nls.localize("mete/board/answer", "Answer")}</h3>
		</header>
		<MarkdownView text={text} renderer={markdown} />
	</section>
);

/** The single agent's steps; its answer, once it has one, leads the center instead (ADR-127). */
export const SingleAgent = ({
	view,
	answer,
	transcript,
	markdown,
	live,
}: {
	readonly view: TeamView;
	readonly answer?: string | undefined;
	readonly transcript: TranscriptState;
	readonly markdown: MarkdownRenderer;
	readonly live: boolean;
}) => {
	const steps = withoutAnswer(
		transcript.transcript?.conversations[0]?.steps ?? [],
		answer,
	);
	const working = steps.length > 0 || view.thinkingSince !== undefined;
	return (
		<>
			{transcript.failure ? (
				<p role="alert" className="mete-note">
					{nls.localize(
						"mete/steps/unread",
						"The agent's steps could not be read: {0}",
						failureText(transcript.failure),
					)}
				</p>
			) : null}
			{working ? (
				<section aria-label={nls.localize("mete/steps/label", "Steps")}>
					<h3 style={TITLE}>{nls.localize("mete/steps/label", "Steps")}</h3>
					<StepList
						steps={steps}
						markdown={markdown}
						live={live}
						thinkingSince={view.thinkingSince}
					/>
				</section>
			) : null}
			{!working && !answer ? (
				<p style={MUTED}>
					{nls.localize(
						"mete/steps/none",
						"A single agent works without a board: its steps appear here as it works, and its answer when it finishes.",
					)}
				</p>
			) : null}
		</>
	);
};
