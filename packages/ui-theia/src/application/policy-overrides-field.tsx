import {
	CapabilityRefSchema,
	err,
	ok,
	type Policy,
	type Result,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Component } from "react";
import { optionLabel } from "./labels.js";
import { readPolicyRule } from "./policy-rule-fields.js";
import { Icon, LINE } from "./roster-look.js";

/** One explicit layer of capability rules; absent keys still merge from inheritance. */
export type PolicyOverridesProps = {
	readonly value: Policy["overrides"] | undefined;
	/** Effective fallback when absent; raw configured global entries when custom. */
	readonly inherited: Policy["overrides"];
	readonly autonomy: Policy["autonomy"];
	readonly disabled?: boolean;
	readonly onChange: (value: Policy["overrides"] | undefined) => void;
};
type Intent =
	| { kind: "source"; mode: string }
	| { kind: "remove"; ref: string }
	| { kind: "add" | "level"; ref: string; level: string };
const iconButton = {
	width: 28,
	height: 28,
	padding: 0,
	flexShrink: 0,
	borderRadius: "4px",
};
const allowedLevel = (level: string, autonomy: Policy["autonomy"]) =>
	/^[0-3]$/.test(level) && Number(level) <= autonomy;

const checked = (value: unknown) => {
	const parsed = readPolicyRule("overrides", value);
	return parsed.ok && parsed.value !== undefined
		? ok(parsed.value)
		: err("invalid" as const);
};
const sourceValue = (props: PolicyOverridesProps, mode: string) => {
	if (mode === "inherited") return ok(undefined);
	return mode === "custom" && props.value === undefined
		? checked({ ...props.inherited })
		: err("unchanged");
};
const removeOwn = (
	props: PolicyOverridesProps,
	ref: keyof Policy["overrides"],
) => {
	if (!Object.hasOwn(props.value ?? {}, ref)) return err("inherited");
	const next = { ...props.value };
	delete next[ref];
	return checked(next);
};

/** Validates a field-local intent without mutating inherited data or emitting changes. */
export const changePolicyOverride = (
	props: PolicyOverridesProps,
	intent: Intent,
): Result<Policy["overrides"] | undefined, string> => {
	if (props.disabled) return err("busy");
	if (intent.kind === "source") return sourceValue(props, intent.mode);
	if (props.value === undefined) return err("inherited");
	const ref = CapabilityRefSchema.safeParse(intent.ref.trim());
	if (!ref.success) return err("invalid");
	const merged = { ...props.inherited, ...props.value };
	if (intent.kind === "remove") return removeOwn(props, ref.data);
	if (!allowedLevel(intent.level, props.autonomy)) return err("invalid");
	if (intent.kind === "add" && Object.hasOwn(merged, ref.data))
		return err("duplicate");
	if (intent.kind === "level" && !Object.hasOwn(merged, ref.data))
		return err("invalid");
	return checked({ ...props.value, [ref.data]: Number(intent.level) });
};

/** Flat native override controls with persistent add drafts and honest layer labels. */
export class PolicyOverridesField extends Component<
	PolicyOverridesProps,
	{ ref: string; level: string }
> {
	override state = { ref: "", level: "0" };

	private emit(intent: Intent): boolean {
		const result = changePolicyOverride(this.props, intent);
		if (!result.ok) return false;
		this.props.onChange(result.value);
		return true;
	}
	private levels(
		label: string,
		value: string,
		onChange: (value: string) => void,
	) {
		const disabled = this.props.disabled || this.props.value === undefined;
		return (
			<select
				className="mete-field"
				aria-label={label}
				value={value}
				disabled={disabled}
				style={{ maxWidth: "100%", minWidth: 0 }}
				onChange={(event) => {
					const next = event.target.value;
					if (
						!this.props.disabled &&
						this.props.value !== undefined &&
						allowedLevel(next, this.props.autonomy)
					)
						onChange(next);
				}}
			>
				{[0, 1, 2, 3].map((level) => (
					<option
						key={level}
						value={level}
						disabled={level > this.props.autonomy}
					>
						{optionLabel(level)}
					</option>
				))}
			</select>
		);
	}
	private source() {
		const custom = this.props.value !== undefined;
		return (
			<select
				className="mete-field"
				aria-label={nls.localize("mete/permissions/source", "Rule source")}
				value={custom ? "custom" : "inherited"}
				disabled={this.props.disabled}
				onChange={(event) => {
					if ((event.target.value === "custom") !== custom)
						this.emit({ kind: "source", mode: event.target.value });
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
	}
	private row(ref: string, level: Policy["autonomy"]) {
		const own = Object.hasOwn(this.props.value ?? {}, ref);
		const remove = nls.localize(
			"mete/permissions/removeOverride",
			"Remove own override {0}",
			ref,
		);
		return (
			<div key={ref} style={LINE}>
				<span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{ref}</span>
				<span>
					{own
						? nls.localize("mete/permissions/ownOverride", "Own override")
						: nls.localize("mete/permissions/inherited", "Inherited")}
				</span>
				{this.levels(
					nls.localize(
						"mete/permissions/overrideRowLevel",
						"Level for {0}",
						ref,
					),
					String(level),
					(next) => this.emit({ kind: "level", ref, level: next }),
				)}
				{level > this.props.autonomy ? (
					<span role="status">
						{nls.localize(
							"mete/permissions/overrideAboveAutonomy",
							"Above current autonomy",
						)}
					</span>
				) : null}
				{own ? (
					<button
						type="button"
						className="mete-button quiet ghost"
						style={iconButton}
						title={remove}
						aria-label={remove}
						disabled={this.props.disabled}
						onClick={() => this.emit({ kind: "remove", ref })}
					>
						<Icon name="trash" />
					</button>
				) : null}
			</div>
		);
	}
	private addCapability(disabled: boolean, valid: boolean) {
		return (
			<input
				className="mete-field"
				aria-label={nls.localize(
					"mete/permissions/overrideCapability",
					"Capability",
				)}
				value={this.state.ref}
				disabled={disabled}
				style={{ minWidth: 0, maxWidth: "100%" }}
				aria-invalid={Boolean(this.state.ref) && !disabled && !valid}
				onChange={(event) => {
					if (!this.props.disabled && this.props.value !== undefined)
						this.setState({ ref: event.target.value });
				}}
			/>
		);
	}
	private add() {
		const disabled = this.props.disabled || this.props.value === undefined;
		const result = changePolicyOverride(this.props, {
			kind: "add",
			...this.state,
		});
		return (
			<div>
				<div style={LINE}>
					{this.addCapability(disabled, result.ok)}
					{this.levels(
						nls.localize("mete/permissions/overrideLevel", "Override level"),
						this.state.level,
						(level) => this.setState({ level }),
					)}
					<button
						type="button"
						className="mete-button quiet ghost"
						style={iconButton}
						title={nls.localize("mete/permissions/addOverride", "Add override")}
						aria-label={nls.localize(
							"mete/permissions/addOverride",
							"Add override",
						)}
						disabled={disabled || !result.ok}
						onClick={() => {
							if (this.emit({ kind: "add", ...this.state }))
								this.setState({ ref: "" });
						}}
					>
						<Icon name="add" />
					</button>
				</div>
				{this.state.ref && !disabled && !result.ok ? (
					<span role="alert" style={{ color: "var(--theia-errorForeground)" }}>
						{result.error === "duplicate"
							? nls.localize(
									"mete/permissions/overrideDuplicate",
									"A rule for this capability already exists",
								)
							: nls.localize(
									"mete/permissions/overrideInvalid",
									"Enter a valid capability and a level at or below autonomy",
								)}
					</span>
				) : null}
			</div>
		);
	}
	override render() {
		const merged = { ...this.props.inherited, ...this.props.value };
		return (
			<fieldset
				disabled={this.props.disabled}
				style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
			>
				<legend>
					{nls.localize(
						"mete/permissions/overrides",
						"Capability approval levels",
					)}
				</legend>
				<div style={{ display: "grid", gap: "8px", minWidth: 0 }}>
					{this.source()}
					{Object.entries(merged).map(([ref, level]) => this.row(ref, level))}
					{this.add()}
				</div>
			</fieldset>
		);
	}
}
