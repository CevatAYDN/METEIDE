import type { TranscriptStep } from "@mete/contracts";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { MarkdownView } from "./markdown-view.js";
import { MessageForm } from "./message-form.js";
import { uniqueKeys } from "./row-keys.js";

type Props = {
	readonly goal: string;
	readonly status?: string | undefined;
	readonly steps: readonly TranscriptStep[];
	readonly markdown: MarkdownRenderer;
	readonly onReply: (message: string) => Promise<string | undefined>;
};

const Turn = ({
	step,
	markdown,
}: {
	readonly step: TranscriptStep;
	readonly markdown: MarkdownRenderer;
}) => {
	if (!step.text) return null;
	if (step.from === "summary")
		return (
			<details className="mete-chat-details">
				<summary>
					{nls.localize("mete/chat/summary", "Earlier messages summarized")}
				</summary>
				<p style={{ whiteSpace: "pre-wrap" }}>{step.text}</p>
			</details>
		);
	const user = step.from === "user";
	return (
		<div
			className={`mete-chat-message ${user ? "mete-chat-user" : "mete-chat-assistant"}`}
		>
			<strong>{user ? nls.localize("mete/chat/you", "You") : "METE"}</strong>
			{user ? (
				<p style={{ whiteSpace: "pre-wrap" }}>{step.text}</p>
			) : (
				<MarkdownView text={step.text} renderer={markdown} />
			)}
		</div>
	);
};

const Turns = ({ steps, markdown }: Pick<Props, "steps" | "markdown">) => {
	const keys = uniqueKeys(
		steps.map((step) => `${step.from ?? "assistant"}:${step.text ?? ""}`),
	);
	return (
		<>
			{steps.map((step, index) => (
				<Turn key={keys[index]} step={step} markdown={markdown} />
			))}
		</>
	);
};

/** Ordinary user/assistant turns first; tool diagnostics stay in the details panel. */
export const Conversation = ({
	goal,
	status,
	steps,
	markdown,
	onReply,
}: Props) => (
	<section
		className="mete-conversation"
		aria-label={nls.localize("mete/chat/title", "Conversation")}
	>
		<div className="mete-chat-message mete-chat-user">
			<strong>{nls.localize("mete/chat/you", "You")}</strong>
			<p style={{ whiteSpace: "pre-wrap" }}>{goal}</p>
		</div>
		<Turns steps={steps} markdown={markdown} />
		<MessageForm status={status} onReply={onReply} />
	</section>
);
