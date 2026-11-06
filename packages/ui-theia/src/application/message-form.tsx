import { nls } from "@theia/core/lib/common/nls";
import { useId, useRef, useState } from "react";

type Props = {
	readonly status?: string | undefined;
	readonly onReply: (message: string) => Promise<string | undefined>;
};

const useMessage = ({ status, onReply }: Props) => {
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const pending = useRef(false);
	const ready = status === "completed" && !busy;
	const send = async () => {
		if (!ready || pending.current || !draft.trim()) return;
		pending.current = true;
		setBusy(true);
		try {
			const failure = await onReply(draft.trim());
			setError(failure);
			if (!failure) setDraft("");
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
				rows={3}
				value={draft}
				disabled={busy}
				onChange={(event) => setDraft(event.target.value)}
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
			<div className="mete-chat-send">
				<span>
					{ready
						? nls.localize(
								"mete/chat/keyboard",
								"Enter to send · Shift+Enter for a new line",
							)
						: nls.localize(
								"mete/chat/wait",
								"Wait for the current response, or resolve the paused run above.",
							)}
				</span>
				<button type="submit" disabled={!ready || !draft.trim()}>
					{nls.localize("mete/chat/send", "Send message")}
				</button>
			</div>
			{error ? <p role="alert">{error}</p> : null}
		</form>
	);
};
