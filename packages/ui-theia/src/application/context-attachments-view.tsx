import type { ContextSnapshot } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { ContextAttachment } from "./context-drafts.js";
import { Icon } from "./roster-look.js";

/** A prepared immutable snapshot is rendered as escaped text, never executable Markdown. */
export const ContextPreview = ({
	snapshot,
}: {
	readonly snapshot: ContextSnapshot;
}) => {
	const { range } = snapshot;
	return (
		<details className="mete-context-preview">
			<summary>
				<Icon name="file-code" /> <span>{snapshot.path}</span>
				{range ? (
					<span>{`${range.start.line + 1}:${range.start.character + 1} - ${range.end.line + 1}:${range.end.character + 1}`}</span>
				) : null}
				{snapshot.modified ? (
					<span>{nls.localize("mete/context/unsaved", "Unsaved")}</span>
				) : null}
			</summary>
			<pre
				role="document"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must focus the bounded source preview to scroll it.
				tabIndex={0}
				aria-label={snapshot.path}
			>
				{snapshot.content}
			</pre>
			<small title={snapshot.sha256}>SHA-256: {snapshot.sha256}</small>
		</details>
	);
};
const Action = (props: {
	label: string;
	icon: string;
	disabled: boolean;
	onClick: () => void;
}) => (
	<button
		type="button"
		className="mete-button quiet icon"
		disabled={props.disabled}
		title={props.label}
		aria-label={props.label}
		onClick={props.onClick}
	>
		<Icon name={props.icon} />
	</button>
);
type Props = {
	readonly items: readonly ContextAttachment[];
	readonly busy: boolean;
	readonly disabled?: boolean | undefined;
	readonly error?: string | undefined;
	readonly onAdd: (mode: "file" | "selection") => void;
	readonly onUpdate: (id: string) => void;
	readonly onRemove: (id: string) => void;
};
const AttachmentMenu = (props: Pick<Props, "disabled" | "onAdd">) => (
	<details className="mete-context-menu">
		<summary
			aria-label={nls.localize("mete/context/add", "Add attachment")}
			title={nls.localize("mete/context/add", "Add attachment")}
		>
			<Icon name="attach" />
		</summary>
		<div>
			<button
				type="button"
				className="mete-button quiet"
				disabled={props.disabled}
				onClick={() => props.onAdd("selection")}
			>
				<Icon name="selection" />{" "}
				{nls.localize("mete/context/selection", "Add selection")}
			</button>
			<button
				type="button"
				className="mete-button quiet"
				disabled={props.disabled}
				onClick={() => props.onAdd("file")}
			>
				<Icon name="file-code" />{" "}
				{nls.localize("mete/context/file", "Add open file")}
			</button>
		</div>
	</details>
);

/** Compact native controls expose explicit add/update/remove, never automatic collection. */
export const ContextAttachments = (props: Props) => {
	const disabled = props.busy || !!props.disabled;
	return (
		<div className="mete-context-draft">
			<AttachmentMenu disabled={disabled} onAdd={props.onAdd} />
			<ul>
				{props.items.map((item) => (
					<li key={item.id}>
						<ContextPreview snapshot={item.snapshot} />
						<Action
							label={nls.localize("mete/context/update", "Update attachment")}
							icon="refresh"
							disabled={disabled}
							onClick={() => props.onUpdate(item.id)}
						/>
						<Action
							label={nls.localize("mete/context/remove", "Remove attachment")}
							icon="close"
							disabled={disabled}
							onClick={() => props.onRemove(item.id)}
						/>
					</li>
				))}
			</ul>
			{props.busy ? (
				<span role="status">
					{nls.localize("mete/context/busy", "Attachment controls are busy.")}
				</span>
			) : null}
			{props.error ? <p role="alert">{props.error}</p> : null}
		</div>
	);
};
