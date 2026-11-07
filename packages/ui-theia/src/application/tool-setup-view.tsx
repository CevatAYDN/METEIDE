import type { Result } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useEffect, useRef, useState } from "react";
import type { McpDraft } from "./mcp-draft.js";
import { Icon } from "./roster-look.js";
import {
	prepareTool,
	type ToolSetup,
	type ToolSetupError,
} from "./tool-setup.js";
import { ToolSetupFields } from "./tool-setup-fields.js";

/** The inline wizard submits drafts atomically; the parent saves and activates separately. */
export type ToolSetupViewProps = {
	readonly onAdd: (drafts: McpDraft) => Result<McpDraft, string>;
	readonly onCancel: () => void;
	readonly onAdvanced: () => void;
};

const focusInput = (root: HTMLFormElement | null, field?: string) =>
	root
		?.querySelector<HTMLElement>(
			field ? `#mete-tool-setup-${field}` : "input, textarea",
		)
		?.focus();

/** Local state is discarded on Cancel, including parsed imports and validation errors. */
export const ToolSetupView = (props: ToolSetupViewProps) => {
	const [input, setInput] = useState<ToolSetup>({ mode: "remote" });
	const [error, setError] = useState<ToolSetupError>();
	const root = useRef<HTMLFormElement>(null);
	useEffect(() => {
		focusInput(root.current, input.mode === "import" ? "json" : "id");
	}, [input.mode]);
	useEffect(() => {
		if (error) focusInput(root.current, error.field);
	}, [error]);
	return (
		<form
			ref={root}
			className="mete-tool-setup"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				submitSetup(input, props, setError);
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					props.onCancel();
				}
			}}
		>
			<ToolSetupFields
				input={input}
				error={error}
				onChange={(next) => {
					setInput(next);
					setError(undefined);
				}}
			/>
			{error &&
			!["id", "url", "httpMode", "command", "args", "runtime", "json"].includes(
				error.field,
			) ? (
				<p role="alert">{error.text}</p>
			) : null}
			<div className="mete-tool-actions">
				<button type="submit" className="mete-button">
					<Icon name="add" />
					{nls.localize("mete/tools/add", "Add")}
				</button>
				<button
					type="button"
					className="mete-button quiet"
					onClick={props.onCancel}
				>
					{nls.localize("mete/tools/cancel", "Cancel")}
				</button>
				<button
					type="button"
					className="mete-button quiet"
					onClick={props.onAdvanced}
				>
					<Icon name="settings-gear" />
					{nls.localize("mete/tools/advancedSetup", "Advanced setup")}
				</button>
			</div>
		</form>
	);
};

const submitSetup = (
	input: ToolSetup,
	props: ToolSetupViewProps,
	onError: (error: ToolSetupError) => void,
) => {
	const prepared = prepareTool(input);
	if (!prepared.ok) return onError(prepared.error);
	const added = props.onAdd(prepared.value);
	if (!added.ok)
		return onError({
			code: "invalid_setup",
			field: input.mode === "import" ? "json" : "id",
			text: added.error,
		});
	props.onCancel();
};
