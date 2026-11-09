import { type Policy, PolicyActionSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { readPolicyRule } from "./policy-rule-fields.js";
import { Icon } from "./roster-look.js";

type Rules = Policy["never_allow"];
type Rule = Rules[number];
type Action = Rule["action"];
type Props = {
	readonly value: Rules | undefined;
	readonly inherited: Rules;
	readonly disabled?: boolean;
	readonly onChange: (value: Rules | undefined) => void;
	readonly onDraft?: (rows: Rules) => void;
};
type Edit =
	| { readonly type: "add"; readonly action: Action }
	| { readonly type: "remove"; readonly index: number }
	| { readonly type: "action"; readonly index: number; readonly action: Action }
	| {
			readonly type: "pattern";
			readonly index: number;
			readonly pattern: string;
	  };
const ACTIONS = PolicyActionSchema.extract([
	"fs.write",
	"fs.delete",
	"fs.write.outside",
	"shell.exec",
]).options;
const labels: Readonly<Record<Action, () => string>> = {
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
};
const patternOf = (rule: Rule) => ("path" in rule ? rule.path : rule.command);
const ruleOf = (action: Action, pattern: string): Rule =>
	action === "shell.exec"
		? { action, command: pattern }
		: { action, path: pattern };
const sameRules = (
	left: Rules | undefined,
	right: Rules | undefined,
): boolean => {
	if (left === right) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((rule, index) => {
		const other = right[index];
		return (
			other !== undefined &&
			rule.action === other.action &&
			patternOf(rule) === patternOf(other)
		);
	});
};

/** Changes exactly one positional deny row, retaining incomplete patterns as local drafts. */
export const editDenyDraft = (rows: Rules, edit: Edit): Rules => {
	if (edit.type === "add") return [...rows, ruleOf(edit.action, "")];
	return rows.flatMap((rule, index) => {
		if (index !== edit.index) return [rule];
		if (edit.type === "remove") return [];
		return [
			ruleOf(
				edit.type === "action" ? edit.action : rule.action,
				edit.type === "pattern" ? edit.pattern : patternOf(rule),
			),
		];
	});
};

/** Publishes only contract-valid deny values, refusing busy or malformed candidates. */
export const publishDenyDraft = (props: Props, candidate: unknown): boolean => {
	if (props.disabled) return false;
	const parsed = readPolicyRule("never_allow", candidate);
	if (!parsed.ok) return false;
	props.onChange(parsed.value);
	return true;
};

/** Retains editor-generated incomplete rows in memory without publishing invalid policy values. */
export const stageDenyDraft = (props: Props, rows: Rules): void => {
	if (props.disabled || props.value === undefined) return;
	if (!publishDenyDraft(props, rows)) props.onDraft?.(rows);
};

const actionField = (
	rule: Rule,
	index: number,
	edit: ((edit: Edit) => void) | undefined,
	busy: boolean,
) => {
	const actionLabel = nls.localize(
		"mete/permissions/denyAction",
		"Rule {0} action",
		index + 1,
	);
	return (
		<label>
			{actionLabel}
			<select
				className="mete-field"
				aria-label={actionLabel}
				value={rule.action}
				disabled={busy || !edit}
				onChange={
					edit
						? (event) => {
								const action = ACTIONS.find((a) => a === event.target.value);
								if (!busy && action) edit({ type: "action", index, action });
							}
						: undefined
				}
			>
				{ACTIONS.map((action) => (
					<option key={action} value={action}>
						{labels[action]()}
					</option>
				))}
			</select>
		</label>
	);
};

const patternLabelOf = (rule: Rule, index: number) =>
	rule.action === "shell.exec"
		? nls.localize(
				"mete/permissions/denyCommand",
				"Rule {0} command pattern",
				index + 1,
			)
		: nls.localize(
				"mete/permissions/denyPath",
				"Rule {0} path pattern",
				index + 1,
			);

// Duplicate rules have positional identity; all row inputs are controlled by the shared draft.
const row = (
	rule: Rule,
	index: number,
	edit: ((edit: Edit) => void) | undefined,
	busy: boolean,
) => {
	const patternLabel = patternLabelOf(rule, index);
	const remove = nls.localize(
		"mete/permissions/denyRemove",
		"Remove deny rule {0}",
		index + 1,
	);
	return (
		<div key={index} style={{ display: "grid", gap: "4px", minWidth: 0 }}>
			{actionField(rule, index, edit, busy)}
			<label>
				{patternLabel}
				<input
					className="mete-field mono"
					aria-label={patternLabel}
					value={patternOf(rule)}
					readOnly={!edit}
					disabled={busy}
					onChange={
						edit
							? (event) => {
									if (!busy)
										edit({
											type: "pattern",
											index,
											pattern: event.target.value,
										});
								}
							: undefined
					}
				/>
			</label>
			{edit ? (
				<button
					type="button"
					className="mete-button quiet icon"
					title={remove}
					aria-label={remove}
					disabled={busy}
					onClick={() => {
						if (!busy) edit({ type: "remove", index });
					}}
				>
					<Icon name="close" />
				</button>
			) : null}
		</div>
	);
};

const DenyEditor = (props: Props) => {
	const [draft, setDraft] = useState({
		source: props.value,
		rows: props.value ?? [],
	});
	const current = sameRules(draft.source, props.value);
	const rows = current ? draft.rows : (props.value ?? []);
	if (!current) setDraft({ source: props.value, rows });
	const change = (edit: Edit) => {
		if (props.disabled || props.value === undefined) return;
		const next = editDenyDraft(rows, edit);
		setDraft({ source: props.value, rows: next });
		stageDenyDraft(props, next);
	};
	return (
		<>
			{rows.map((rule, index) => row(rule, index, change, !!props.disabled))}
			{!readPolicyRule("never_allow", rows).ok ? (
				<p role="alert">
					{nls.localize(
						"mete/permissions/denyInvalid",
						"A path or command pattern is missing or invalid",
					)}
				</p>
			) : null}
			<div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
				{ACTIONS.map((action) => (
					<button
						key={action}
						type="button"
						className="mete-button quiet"
						disabled={props.disabled}
						onClick={() => change({ type: "add", action })}
					>
						<Icon name="add" />
						{nls.localize(
							"mete/permissions/denyAdd",
							"Add rule: {0}",
							labels[action](),
						)}
					</button>
				))}
			</div>
		</>
	);
};

/** Edits configured deny rules without changing protected-path enforcement or policy evaluation. */
export const PolicyDenyField = (props: Props) => (
	<fieldset
		disabled={props.disabled}
		style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
	>
		<legend>
			{nls.localize("mete/permissions/neverAllow", "Denied paths and commands")}
		</legend>
		<div style={{ display: "grid", gap: "8px", minWidth: 0 }}>
			<select
				className="mete-field"
				style={{ borderRadius: "4px" }}
				aria-label={nls.localize(
					"mete/permissions/denySource",
					"Deny rule source",
				)}
				value={props.value === undefined ? "inherited" : "custom"}
				disabled={props.disabled}
				onChange={(event) => {
					if (props.disabled) return;
					if (event.target.value === "inherited" && props.value !== undefined)
						publishDenyDraft(props, undefined);
					if (event.target.value === "custom" && props.value === undefined)
						publishDenyDraft(
							props,
							props.inherited.map((rule) => ({ ...rule })),
						);
				}}
			>
				<option value="inherited">
					{nls.localize("mete/permissions/inherited", "Inherited")}
				</option>
				<option value="custom">
					{nls.localize("mete/permissions/custom", "Custom rules")}
				</option>
			</select>
			{props.value === undefined ? (
				props.inherited.map((rule, index) =>
					row(rule, index, undefined, !!props.disabled),
				)
			) : (
				<DenyEditor {...props} />
			)}
		</div>
	</fieldset>
);
