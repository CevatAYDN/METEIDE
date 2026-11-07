import { nls } from "@theia/core/lib/common/nls";
import { type ReactNode, useId, useRef, useState } from "react";
import type { MessageDraft } from "./context-drafts.js";
import { Icon } from "./roster-look.js";

type Props = {
	readonly status?: string | undefined;
	readonly onReply: (message: string) => Promise<string | undefined>;
	readonly tools?: ReactNode | undefined;
	readonly replyReady?: boolean | undefined;
	readonly onDraftChange?: (() => void) | undefined;
	readonly messageDraft?: MessageDraft | undefined;
	readonly attachments?: ReactNode | undefined;
};

const useMessage = ({ status, onReply, replyReady, messageDraft }: Props) => {
	const [localDraft, setLocalDraft] = useState("");
	const draft = messageDraft?.value ?? localDraft;
	const setDraft = messageDraft?.onChange ?? setLocalDraft;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const pending = useRef(false);
	const ready =
		status === "completed" &&
		replyReady !== false &&
		!busy &&
		!messageDraft?.busy;
	const send = async () => {
		if (!ready || pending.current || !draft.trim()) return;
		pending.current = true;
		setBusy(true);
		try {
			const failure = await onReply(draft.trim());
			setError(failure);
			if (!failure && !messageDraft) setLocalDraft("");
		} catch {
			setError(
				nls.localize(
					"mete/chat/sendFailed",
					"Could not send. Your message is kept; try again.",
				),
			);
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};
	return { draft, setDraft, busy, error, ready, send };
};

const WaitNote = ({ replyReady }: Pick<Props, "replyReady">) => (
	<span role="status" className="mete-chat-wait">
		{replyReady === false
			? nls.localize(
					"mete/thread/returnLatest",
					"Return to the latest turn to reply.",
				)
			: nls.localize(
					"mete/chat/wait",
					"Wait for the current response, or resolve the paused run above.",
				)}
	</span>
);

/** A draft remains editable while work is in flight; only Send waits for completion. */
export const MessageForm = (props: Props) => {
	const id = useId();
	const { draft, setDraft, busy, error, ready, send } = useMessage(props);
	return (
		<form
			className="mete-chat-composer"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<label htmlFor={id}>
				{nls.localize("mete/chat/message", "Message METE")}
			</label>
			<textarea
				id={id}
				className="mete-field"
				rows={2}
				value={draft}
				disabled={
					busy || props.messageDraft?.busy || props.replyReady === false
				}
				onChange={(event) => {
					props.onDraftChange?.();
					setDraft(event.target.value);
				}}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						!event.shiftKey &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault();
						void send();
					}
				}}
			/>
			{props.attachments}
			<div className="mete-chat-send">
				<div className="mete-chat-tools">{props.tools}</div>
				<button
					type="submit"
					className="mete-button icon"
					disabled={!ready || !draft.trim()}
					aria-label={nls.localize("mete/chat/send", "Send message")}
					title={nls.localize("mete/chat/send", "Send message")}
				>
					<Icon name={busy ? "loading" : "send"} spin={busy} />
				</button>
			</div>
			{!ready ? <WaitNote replyReady={props.replyReady} /> : null}
			{error ? <p role="alert">{error}</p> : null}
		</form>
	);
};
