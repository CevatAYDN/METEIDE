import type { TranscriptStep } from "@mete/contracts";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { MessageDraft } from "./context-drafts.js";
import { AttachedContext, isContextEnvelope } from "./conversation-context.js";
import { MarkdownView } from "./markdown-view.js";
import { MessageForm } from "./message-form.js";
import { uniqueKeys } from "./row-keys.js";

type Props = {
	readonly goal: string;
	readonly status?: string | undefined;
	readonly steps: readonly TranscriptStep[];
	readonly markdown: MarkdownRenderer;
	readonly onReply: (message: string) => Promise<string | undefined>;
	readonly tools?: ReactNode | undefined;
	readonly details?: ReactNode;
	readonly replyReady?: boolean | undefined;
	readonly onDraftChange?: (() => void) | undefined;
	readonly conversationKey?: string | undefined;
	readonly messageDraft?: MessageDraft | undefined;
	readonly attachments?: ReactNode | undefined;
};

const Turn = ({
	step,
	markdown,
}: {
	readonly step: TranscriptStep;
	readonly markdown: MarkdownRenderer;
}) => {
	if (!step.text) return null;
	if (isContextEnvelope(step)) return <AttachedContext text={step.text} />;
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
	tools,
	details,
	replyReady,
	onDraftChange,
	conversationKey,
	messageDraft,
	attachments,
}: Props) => (
	<section
		className="mete-conversation"
		aria-label={nls.localize("mete/chat/title", "Conversation")}
	>
		<section
			className="mete-chat-scroll"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must focus the transcript to scroll it without moving the composer.
			tabIndex={0}
			aria-label={nls.localize("mete/chat/messages", "Messages")}
		>
			<div className="mete-chat-message mete-chat-user">
				<strong>{nls.localize("mete/chat/you", "You")}</strong>
				<p style={{ whiteSpace: "pre-wrap" }}>{goal}</p>
			</div>
			<Turns steps={steps} markdown={markdown} />
			{details}
		</section>
		<MessageForm
			key={conversationKey}
			status={status}
			onReply={onReply}
			tools={tools}
			replyReady={replyReady}
			onDraftChange={onDraftChange}
			messageDraft={messageDraft}
			attachments={attachments}
		/>
	</section>
);
