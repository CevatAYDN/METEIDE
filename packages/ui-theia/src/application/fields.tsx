import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import { ROW } from "./look.js";

// The team editor's plain fields (ADR-075): text, chips of ids and counts. A blank optional field
// goes out as undefined, so the key leaves the file.

/** A change at a path of the template; undefined removes the key. */
export type OnEdit = (
	path: readonly (string | number)[],
	value: unknown,
) => void;

export const FIELD = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
} as const;
export const orNone = (v: string) => (v.trim() ? v : undefined);
export const orEmpty = (v: readonly string[]) => (v.length > 0 ? v : undefined);

/** A list of ids as removable chips, with a field that adds one, offering `hints`. */
export const Chips = (props: {
	readonly label: string;
	readonly values: readonly string[];
	readonly hints: readonly string[];
	readonly onChange: (values: readonly string[]) => void;
}) => {
	const [draft, setDraft] = useState("");
	const list = useId();
	const add = () => {
		const v = draft.trim();
		if (v && !props.values.includes(v)) props.onChange([...props.values, v]);
		setDraft("");
	};
	return (
		<div style={FIELD}>
			<span>{props.label}</span>
			<div style={ROW}>
				{props.values.map((v) => (
					<button
						key={v}
						type="button"
						className="mete-button quiet"
						title={nls.localize("mete/team/removeChip", "Remove {0}", v)}
						onClick={() => props.onChange(props.values.filter((x) => x !== v))}
					>
						{v} ×
					</button>
				))}
				<input
					className="mete-field"
					style={{ width: "14em" }}
					list={list}
					value={draft}
					aria-label={props.label}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") add();
					}}
					onBlur={add}
				/>
				<datalist id={list}>
					{props.hints.map((h) => (
						<option key={h} value={h} />
					))}
				</datalist>
			</div>
		</div>
	);
};

/** A line or, given rows, a box of text. */
export const Text = (props: {
	readonly label: string;
	readonly value: string;
	readonly rows?: number;
	readonly disabled?: boolean;
	readonly onChange: (value: string) => void;
}) =>
	props.rows ? (
		<label style={FIELD}>
			{props.label}
			<textarea
				className="mete-field"
				rows={props.rows}
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
			/>
		</label>
	) : (
		<label style={FIELD}>
			{props.label}
			<input
				className="mete-field"
				value={props.value}
				disabled={props.disabled}
				onChange={(e) => props.onChange(e.target.value)}
			/>
		</label>
	);

/** A whole number, or a blank that leaves the key out so the template's default applies. */
export const Count = (props: {
	readonly label: string;
	readonly value: number | undefined;
	readonly fallback: number;
	readonly disabled?: boolean;
	readonly onChange: (value: number | undefined) => void;
}) => (
	<label style={FIELD}>
		{props.label}
		<input
			className="mete-field"
			type="number"
			min={0}
			style={{ width: "8em" }}
			value={props.value ?? ""}
			placeholder={String(props.fallback)}
			disabled={props.disabled}
			onChange={(e) =>
				props.onChange(
					e.target.value === "" ? undefined : Number(e.target.value),
				)
			}
		/>
	</label>
);

/** A set of ticks, one per option. */
export const Ticks = (props: {
	readonly label: string;
	readonly options: readonly string[];
	readonly values: readonly string[];
	readonly onChange: (values: readonly string[]) => void;
}) => (
	<fieldset style={{ border: "none", padding: 0, margin: 0 }}>
		<legend>{props.label}</legend>
		<div style={ROW}>
			{props.options.map((o) => (
				<label key={o} style={ROW}>
					<input
						type="checkbox"
						checked={props.values.includes(o)}
						onChange={(e) =>
							props.onChange(
								e.target.checked
									? [...props.values, o]
									: props.values.filter((v) => v !== o),
							)
						}
					/>
					{o}
				</label>
			))}
		</div>
	</fieldset>
);

/** One tick. */
export const Tick = (props: {
	readonly label: string;
	readonly checked: boolean;
	readonly onChange: (checked: boolean) => void;
}) => (
	<label style={ROW}>
		<input
			type="checkbox"
			checked={props.checked}
			onChange={(e) => props.onChange(e.target.checked)}
		/>
		{props.label}
	</label>
);
