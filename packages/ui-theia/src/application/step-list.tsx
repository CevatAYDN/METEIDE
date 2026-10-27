import type { TranscriptStep } from "@mete/contracts";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import { MarkdownView } from "./markdown-view.js";
import { Icon } from "./roster-look.js";
import { elapsedText } from "./time-text.js";

// An agent's steps (ADR-125, docs/13), as current agent IDEs show a turn: its words as Markdown and
// each tool call as one line that opens its arguments and result. The agent's words go through the
// sanitizing Markdown renderer; every other text is React-escaped. Laid out by style/mete-run.css.

type ToolCall = TranscriptStep["toolCalls"][number];

const parsed = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

// A tool's family picks its icon; a tool METE does not name (an MCP server's) gets the generic one.
const ICONS: readonly (readonly [RegExp, string])[] = [
	[/^fs_(read|list)/, "file"],
	[/^fs_(grep|glob|search)/, "search"],
	[/^fs_/, "edit"],
	[/^shell_/, "terminal"],
	[/^web_/, "globe"],
	[/^browser_/, "browser"],
	[/^vcs_/, "git-commit"],
];

const iconOf = (name: string) =>
	ICONS.find(([re]) => re.test(name))?.[1] ?? "tools";

/** A tool call's line: the tool and its first text argument, as `fs_read README.md`. */
export const callLabel = (c: ToolCall) => {
	const args = parsed(c.args);
	const first =
		typeof args === "object" && args !== null
			? Object.values(args).find((v) => typeof v === "string")
			: undefined;
	return typeof first === "string" ? `${c.name} ${first}` : c.name;
};

/** A result as a reader wants it: text or a file's content as it is, any other value as indented JSON. */
export const resultBody = (text: string) => {
	const v = parsed(text);
	if (typeof v === "string") return v;
	if (typeof v === "object" && v !== null && "content" in v)
		if (typeof v.content === "string") return v.content;
	return v === undefined ? text : JSON.stringify(v, null, 2);
};

const argsBody = (text: string) => {
	const v = parsed(text);
	return v === undefined ? text : JSON.stringify(v, null, 2);
};

type Look = { readonly tone: string; readonly word: string; spin?: true };

// A call without a result runs while the run does; once the run stopped it never got one.
const lookOf = (c: ToolCall, live: boolean): Look => {
	if (!c.result)
		return live
			? {
					tone: "accent",
					spin: true,
					word: nls.localize("mete/steps/running", "Running…"),
				}
			: { tone: "", word: nls.localize("mete/steps/noResult", "No result") };
	if (c.result.ok === false)
		return {
			tone: "bad",
			word: nls.localize("mete/steps/failedCall", "Failed"),
		};
	return { tone: "good", word: nls.localize("mete/steps/done", "Done") };
};

const Block = ({
	title,
	text,
}: {
	readonly title: string;
	readonly text: string;
}) => (
	<div className="mete-step-block">
		<span className="mete-step-caption">{title}</span>
		<pre className="mete-step-code">{text}</pre>
	</div>
);

const ToolRow = ({
	call,
	live,
}: {
	readonly call: ToolCall;
	readonly live: boolean;
}) => {
	const [open, setOpen] = useState(false);
	const id = useId();
	const look = lookOf(call, live);
	const label = callLabel(call);
	return (
		<li>
			<button
				type="button"
				className="mete-item mete-step-row"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
			>
				<span className={`mete-tile ${look.tone}`} aria-hidden="true">
					<Icon
						name={look.spin ? "loading" : iconOf(call.name)}
						{...(look.spin ? { spin: true } : {})}
					/>
				</span>
				<span className="mete-mono mete-title" title={label}>
					{label}
				</span>
				<span className="mete-sub">{look.word}</span>
				<Icon name={open ? "chevron-down" : "chevron-right"} />
			</button>
			<div id={id} className="mete-step-detail" hidden={!open}>
				{open ? (
					<>
						<Block
							title={nls.localize("mete/steps/arguments", "Arguments")}
							text={argsBody(call.args)}
						/>
						{call.result ? (
							<Block
								title={
									call.result.ok === false
										? nls.localize("mete/steps/error", "Error")
										: nls.localize("mete/steps/result", "Result")
								}
								text={resultBody(call.result.text)}
							/>
						) : null}
					</>
				) : null}
			</div>
		</li>
	);
};

// A user message after the opening: the summary of earlier turns, or a reviewer's feedback.
const Note = ({ step }: { readonly step: TranscriptStep }) => {
	const [open, setOpen] = useState(step.from === "user");
	const id = useId();
	const summary = step.from === "summary";
	return (
		<li>
			<button
				type="button"
				className="mete-item mete-step-row"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
			>
				<span className="mete-tile" aria-hidden="true">
					<Icon name={summary ? "fold" : "comment"} />
				</span>
				<span className="mete-title">
					{summary
						? nls.localize("mete/steps/summary", "Earlier steps, summarized")
						: nls.localize("mete/steps/feedback", "Feedback")}
				</span>
				<span />
				<Icon name={open ? "chevron-down" : "chevron-right"} />
			</button>
			<div id={id} className="mete-step-detail" hidden={!open}>
				{open ? <pre className="mete-step-code">{step.text}</pre> : null}
			</div>
		</li>
	);
};

/** The row of a model call in flight, with how long it has been running. */
export const ThinkingRow = ({ since }: { readonly since: string }) => (
	<li className="mete-item mete-step-row mete-step-live">
		<span className="mete-tile accent" aria-hidden="true">
			<Icon name="loading" spin />
		</span>
		<span className="mete-title">
			{nls.localize("mete/steps/thinking", "Thinking… {0}", elapsedText(since))}
		</span>
	</li>
);

/** One conversation's steps, and the call in flight at its end. */
export const StepList = ({
	steps,
	markdown,
	live,
	thinkingSince,
}: {
	readonly steps: readonly TranscriptStep[];
	readonly markdown: MarkdownRenderer;
	readonly live: boolean;
	readonly thinkingSince?: string | undefined;
}) => (
	<ol
		className="mete-steps"
		aria-label={nls.localize("mete/steps/label", "Steps")}
	>
		{steps.map((s, i) =>
			s.from ? (
				// biome-ignore lint/suspicious/noArrayIndexKey: steps have no id; they grow at the end, and a summary folding earlier ones only resets which rows are open.
				<Note key={i} step={s} />
			) : (
				// biome-ignore lint/suspicious/noArrayIndexKey: as above.
				<li key={i} className="mete-step">
					{s.text ? <MarkdownView text={s.text} renderer={markdown} /> : null}
					{s.toolCalls.length > 0 ? (
						<ul className="mete-step-calls">
							{s.toolCalls.map((c, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a step's calls never reorder.
								<ToolRow key={j} call={c} live={live} />
							))}
						</ul>
					) : null}
				</li>
			),
		)}
		{thinkingSince ? <ThinkingRow since={thinkingSince} /> : null}
	</ol>
);
