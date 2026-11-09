import {
	SKILL_RUNTIME_LIMITS,
	type SkillPolicy,
	type SkillRuntimeCatalog,
	type SkillRuntimeDescriptor,
	type SkillVersion,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import { skillScopeText } from "./skill-text.js";

const sameVersion = (a: SkillVersion, b: SkillVersion) =>
	a.sourceId === b.sourceId &&
	a.sha256 === b.sha256 &&
	a.revision === b.revision;

/** `off` requires an empty selection; switching between `auto` and `manual` preserves order. */
export const changeSkillMode = (
	policy: SkillPolicy,
	mode: SkillPolicy["mode"],
): SkillPolicy => ({
	mode,
	selected: mode === "off" ? [] : [...policy.selected],
});

export const canSelectSkillVersion = (
	policy: SkillPolicy,
	version: SkillVersion | undefined,
): boolean => {
	if (!version || policy.mode === "off") return false;
	if (policy.selected.some((item) => sameVersion(item, version))) return true;
	return (
		policy.selected.length < SKILL_RUNTIME_LIMITS.perContext &&
		!policy.selected.some((item) => item.sourceId === version.sourceId)
	);
};

/** Ordered distinct source versions, bounded at four per context without silent replacement. */
export const toggleSelectedSkill = (
	policy: SkillPolicy,
	version: SkillVersion | undefined,
	checked: boolean,
): SkillPolicy => {
	if (!version) return policy;
	if (!checked)
		return {
			...policy,
			selected: policy.selected.filter((item) => !sameVersion(item, version)),
		};
	if (
		policy.selected.some((item) => sameVersion(item, version)) ||
		!canSelectSkillVersion(policy, version)
	)
		return policy;
	return { ...policy, selected: [...policy.selected, version] };
};

type Props = {
	readonly label?: string | undefined;
	readonly policy: SkillPolicy;
	readonly catalog: SkillRuntimeCatalog | undefined;
	readonly disabled?: boolean | undefined;
	readonly onMode?: ((mode: SkillPolicy["mode"]) => void) | undefined;
	readonly onToggle: (version: SkillVersion, checked: boolean) => void;
};

const entryLabel = (entry: SkillRuntimeDescriptor) =>
	`${skillScopeText(entry.source.scope)} · ${entry.source.path} · r${entry.version.revision}`;

const staleSelections = (
	policy: SkillPolicy,
	entries: readonly SkillRuntimeDescriptor[],
) =>
	policy.selected.filter(
		(version) => !entries.some((entry) => sameVersion(entry.version, version)),
	);

const CatalogRow = ({
	entry,
	policy,
	disabled,
	id,
	onToggle,
}: Pick<Props, "policy" | "disabled" | "onToggle"> & {
	readonly entry: SkillRuntimeDescriptor;
	readonly id: string;
}) => {
	const checked = policy.selected.some((v) => sameVersion(v, entry.version));
	const inputId = `${id}-${entry.version.sourceId.slice(0, 12)}`;
	return (
		<label htmlFor={inputId}>
			<input
				id={inputId}
				type="checkbox"
				checked={checked}
				disabled={
					disabled ||
					(!checked && !canSelectSkillVersion(policy, entry.version))
				}
				onChange={(e) => onToggle(entry.version, e.target.checked)}
			/>
			<span>{`${entry.name} (${entryLabel(entry)})`}</span>
		</label>
	);
};

const CatalogList = (props: Props & { readonly id: string }) => {
	const { catalog, policy, disabled, onToggle, id } = props;
	if (!catalog) return null;
	if (catalog.status === "unavailable")
		return (
			<p className="mete-composer-hint">
				{nls.localize(
					"mete/skills/catalogUnavailable",
					"Skill catalog unavailable.",
				)}
			</p>
		);
	const stale = staleSelections(policy, catalog.entries);
	if (catalog.entries.length === 0 && stale.length === 0)
		return (
			<p className="mete-composer-hint">
				{nls.localize("mete/skills/noneApproved", "No approved skills.")}
			</p>
		);
	return (
		<div className="mete-skill-selection-list">
			{catalog.entries.map((entry) => (
				<CatalogRow key={entry.version.sourceId} {...props} entry={entry} />
			))}
			{stale.map((version) => {
				const inputId = `${id}-stale-${version.sourceId.slice(0, 12)}`;
				return (
					<label
						key={`${version.sourceId}-${version.revision}`}
						htmlFor={inputId}
					>
						<input
							id={inputId}
							type="checkbox"
							checked
							disabled={disabled}
							onChange={() => onToggle(version, false)}
						/>
						<span>{`${version.sourceId.slice(0, 12)} · r${version.revision}`}</span>
					</label>
				);
			})}
		</div>
	);
};

/** Mode menu and source-qualified exact version checkboxes; approval stays in Settings (ADR-190). */
export const SkillSelectionControl = (props: Props) => {
	const id = useId();
	const modeId = `${id}-mode`;
	return (
		<fieldset
			className="mete-skill-selection"
			aria-label={
				props.label ?? nls.localize("mete/skills/selection", "Skills")
			}
		>
			{props.onMode ? (
				<label htmlFor={modeId}>
					<span>{nls.localize("mete/skills/mode", "Skill mode")}</span>
					<select
						id={modeId}
						className="theia-select"
						value={props.policy.mode}
						disabled={props.disabled}
						onChange={(e) =>
							props.onMode?.(e.target.value as SkillPolicy["mode"])
						}
					>
						<option value="auto">
							{nls.localize("mete/skills/modeAuto", "Automatic")}
						</option>
						<option value="manual">
							{nls.localize("mete/skills/modeManual", "Manual")}
						</option>
						<option value="off">
							{nls.localize("mete/skills/modeOff", "Off")}
						</option>
					</select>
				</label>
			) : null}
			{props.policy.mode === "off" ? null : <CatalogList {...props} id={id} />}
		</fieldset>
	);
};
