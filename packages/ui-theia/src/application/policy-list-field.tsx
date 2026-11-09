import { type PolicyAction, PolicyActionSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Chips } from "./fields.js";

type Props = {
	readonly field: "always_ask" | "shell.allow" | "shell.always";
	readonly value: readonly string[] | undefined;
	readonly inherited: readonly string[];
	readonly disabled?: boolean;
	readonly onChange: (value: readonly string[] | undefined) => void;
};

const actionLabels: Readonly<Record<PolicyAction, () => string>> = {
	"fs.write": () =>
		nls.localize("mete/permissions/actionFsWrite", "Write files"),
	"fs.delete": () =>
		nls.localize("mete/permissions/actionFsDelete", "Delete files"),
	"fs.write.outside": () =>
		nls.localize(
			"mete/permissions/actionFsOutside",
			"Write outside the project",
		),
	"shell.exec": () =>
		nls.localize("mete/permissions/actionShell", "Run commands"),
	"git.commit": () =>
		nls.localize("mete/permissions/actionGitCommit", "Commit changes"),
	"git.push": () =>
		nls.localize("mete/permissions/actionGitPush", "Push commits"),
	"git.merge": () =>
		nls.localize("mete/permissions/actionGitMerge", "Merge changes"),
	"net.fetch": () =>
		nls.localize("mete/permissions/actionFetch", "Fetch web content"),
	"plugin.install": () =>
		nls.localize("mete/permissions/actionPlugin", "Install plugins"),
	"mcp.install": () =>
		nls.localize("mete/permissions/actionMcpInstall", "Install tool servers"),
	"mcp.call": () =>
		nls.localize("mete/permissions/actionMcpCall", "Call connected tools"),
	"mcp.sampling": () =>
		nls.localize(
			"mete/permissions/actionMcpSampling",
			"Model requests from tools",
		),
	"runtime.install": () =>
		nls.localize("mete/permissions/actionRuntime", "Install runtimes"),
	"release.publish": () =>
		nls.localize("mete/permissions/actionRelease", "Publish releases"),
	"vault.write.personal": () =>
		nls.localize(
			"mete/permissions/actionPersonalVault",
			"Write personal notes",
		),
};
const fieldLabels: Readonly<Record<Props["field"], () => string>> = {
	always_ask: () =>
		nls.localize("mete/permissions/alwaysAsk", "Actions that ask first"),
	"shell.allow": () =>
		nls.localize(
			"mete/permissions/shellAllow",
			"Commands allowed at risky approval",
		),
	"shell.always": () =>
		nls.localize(
			"mete/permissions/shellAlways",
			"Remembered command approvals",
		),
};

const changeAction = (
	props: Props,
	values: readonly string[],
	action: PolicyAction,
	checked: boolean,
) => {
	if (props.disabled || props.value === undefined) return;
	const next = checked
		? values.includes(action)
			? values
			: [...values, action]
		: values.filter((value) => value !== action);
	props.onChange([...next]);
};

const actions = (props: Props) => {
	const values = props.value ?? props.inherited;
	const editable = props.value !== undefined && !props.disabled;
	return PolicyActionSchema.options.map((action) => (
		<label
			key={action}
			style={{ display: "flex", gap: "8px", alignItems: "center" }}
		>
			<input
				type="checkbox"
				aria-label={actionLabels[action]()}
				checked={values.includes(action)}
				disabled={!editable}
				onChange={
					editable
						? (event) =>
								changeAction(props, values, action, event.target.checked)
						: undefined
				}
			/>
			{actionLabels[action]()}
		</label>
	));
};

const commands = (props: Props, label: string) =>
	props.value === undefined ? (
		<pre
			style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
		>
			{props.inherited.length
				? props.inherited.join("\n")
				: nls.localize("mete/permissions/empty", "No rules")}
		</pre>
	) : (
		<Chips
			label={label}
			values={props.value}
			hints={[]}
			onChange={(values) => {
				if (!props.disabled && props.value !== undefined)
					props.onChange(values);
			}}
		/>
	);

const source = (props: Props) => (
	<select
		className="mete-field"
		style={{ borderRadius: "4px", minWidth: 0, maxWidth: "100%" }}
		aria-label={nls.localize("mete/permissions/source", "Rule source")}
		value={props.value === undefined ? "inherited" : "custom"}
		disabled={props.disabled}
		onChange={(event) => {
			if (props.disabled) return;
			if (event.target.value === "inherited" && props.value !== undefined)
				props.onChange(undefined);
			if (event.target.value === "custom" && props.value === undefined)
				props.onChange([...props.inherited]);
		}}
	>
		<option value="inherited">
			{nls.localize("mete/permissions/inherited", "Inherited")}
		</option>
		<option value="custom">
			{nls.localize("mete/permissions/custom", "Custom rules")}
		</option>
	</select>
);

/** Native policy list editing; inherited values are read-only and empty overrides stay explicit. */
export const PolicyListField = (props: Props) => {
	const label = fieldLabels[props.field]();
	return (
		<fieldset
			disabled={props.disabled}
			style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
		>
			<legend>{label}</legend>
			<div style={{ display: "grid", gap: "8px", minWidth: 0 }}>
				{source(props)}
				{props.field === "always_ask" ? actions(props) : commands(props, label)}
			</div>
		</fieldset>
	);
};
