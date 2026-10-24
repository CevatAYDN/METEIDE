import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";

// A Settings card's fields (ADR-087, ADR-097): a label over its input, as Theia's own forms have
// them, so a screen reader reads the two together.

const COLUMN = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
} as const;

const Field = ({
	id,
	label,
	children,
}: {
	readonly id: string;
	readonly label: string;
	readonly children: ReactNode;
}) => (
	<div style={COLUMN}>
		<label htmlFor={id}>{label}</label>
		{children}
	</div>
);

/** A labelled text input. */
export const TextField = ({
	id,
	label,
	value,
	placeholder,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly placeholder?: string | undefined;
	readonly onChange: (value: string) => void;
}) => (
	<Field id={id} label={label}>
		<input
			id={id}
			className="mete-field"
			value={value}
			placeholder={placeholder}
			onChange={(e) => onChange(e.target.value)}
		/>
	</Field>
);

/** A labelled textarea, for a list the user writes one line at a time. */
export const TextArea = ({
	id,
	label,
	value,
	rows = 2,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly rows?: number | undefined;
	readonly onChange: (value: string) => void;
}) => (
	<Field id={id} label={label}>
		<textarea
			id={id}
			className="mete-field"
			rows={rows}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		/>
	</Field>
);

/** A labelled choice of a closed list; a blank first option leaves it unset. */
export const Select = ({
	id,
	label,
	value,
	options,
	blank = true,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly options: readonly string[];
	readonly blank?: boolean | undefined;
	readonly onChange: (value: string) => void;
}) => (
	<Field id={id} label={label}>
		<select
			id={id}
			className="mete-field"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{blank ? (
				<option value="">
					{nls.localize("mete/settings/choose", "Choose…")}
				</option>
			) : null}
			{options.map((option) => (
				<option key={option} value={option}>
					{option}
				</option>
			))}
		</select>
	</Field>
);
