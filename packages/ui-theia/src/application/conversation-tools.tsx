import type { ConversationCapability } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";

type Group = "web" | "mcp";
type Props = {
	readonly capabilities: readonly ConversationCapability[] | undefined;
	readonly disabled?: boolean | undefined;
	readonly onChange: (selection: readonly ConversationCapability[]) => void;
};
const GROUPS: Readonly<Record<Group, readonly ConversationCapability[]>> = {
	web: ["web.search@1", "web.fetch@1"],
	mcp: ["mcp.tools@1"],
};

/** Replace one group without duplicating capabilities or changing the other group's selection. */
export const toggleConversationGroup = (
	selected: readonly ConversationCapability[],
	group: Group,
	checked: boolean,
): ConversationCapability[] =>
	checked
		? [...new Set([...selected, ...GROUPS[group]])]
		: selected.filter((ref) => !GROUPS[group].includes(ref));

const groupState = (group: Group, capabilities: Props["capabilities"]) => {
	const selected = GROUPS[group].filter((ref) => capabilities?.includes(ref));
	return {
		mixed:
			capabilities === undefined ||
			(selected.length > 0 && selected.length < GROUPS[group].length),
		checked: selected.length === GROUPS[group].length,
	};
};

const checkboxFor = (group: Group, props: Props, id: string) => {
	const { capabilities, disabled, onChange } = props;
	const { checked, mixed } = groupState(group, capabilities);
	return (
		<input
			id={id}
			type="checkbox"
			checked={checked}
			aria-checked={mixed ? "mixed" : checked}
			disabled={disabled || capabilities === undefined}
			title={
				mixed
					? nls.localize("mete/chat/savedTools", "Saved selection")
					: undefined
			}
			ref={(node) => {
				if (node) node.indeterminate = mixed;
			}}
			onChange={(event) => {
				if (disabled || capabilities === undefined) return;
				onChange(
					toggleConversationGroup(capabilities, group, event.target.checked),
				);
			}}
		/>
	);
};

const labelFor = (group: Group, props: Props, id: string) => (
	<label
		key={group}
		htmlFor={`${id}-${group}`}
		style={{ display: "inline-flex", alignItems: "center" }}
	>
		{checkboxFor(group, props, `${id}-${group}`)}
		<span>
			{group === "web"
				? nls.localize("mete/chat/webTools", "Web")
				: nls.localize(
						"mete/chat/mcpTools",
						"MCP servers (all configured servers)",
					)}
		</span>
	</label>
);

/** Unknown saved selection is mixed, never a false claim that persisted tools are disabled. */
export const ConversationTools = (props: Props) => {
	const id = useId();
	return (
		<fieldset
			className="mete-conversation-tools"
			aria-label={nls.localize("mete/chat/tools", "Conversation tools")}
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: "12px",
				border: 0,
				margin: 0,
				padding: 0,
				minWidth: 0,
			}}
		>
			{(["web", "mcp"] as const).map((group) => labelFor(group, props, id))}
			{props.capabilities === undefined && (
				<button
					type="button"
					className="theia-button secondary"
					disabled={props.disabled}
					onClick={() => {
						if (!props.disabled) props.onChange([]);
					}}
				>
					{nls.localize(
						"mete/chat/replaceSavedTools",
						"Replace saved selection",
					)}
				</button>
			)}
		</fieldset>
	);
};
