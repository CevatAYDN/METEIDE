import { nls } from "@theia/core/lib/common/nls";
import type { Question } from "../domain/questions.js";

// The questions a task asks the human before its work, one per line (ADR-142). Each likely answer
// its agent offers is a button that fills in the answer and never sends it, since the human's
// answer reaches the task once (ADR-148).

const Options = ({
	question,
	onPick,
}: {
	readonly question: Question;
	readonly onPick: (question: string, option: string) => void;
}) => (
	<span className="mete-wait-options">
		{question.options.map((o) => (
			<button
				key={o}
				type="button"
				className="mete-chip"
				aria-label={nls.localize(
					"mete/waiting/pick",
					"Answer “{0}” with {1}",
					question.text,
					o,
				)}
				onClick={() => onPick(question.text, o)}
			>
				{o}
			</button>
		))}
	</span>
);

export const QuestionList = ({
	questions,
	onPick,
}: {
	readonly questions: readonly Question[];
	readonly onPick: (question: string, option: string) => void;
}) => (
	<ul className="mete-wait-questions">
		{questions.map((q) => (
			<li key={q.text}>
				{q.text}
				{q.options.length > 0 ? <Options question={q} onPick={onPick} /> : null}
			</li>
		))}
	</ul>
);
