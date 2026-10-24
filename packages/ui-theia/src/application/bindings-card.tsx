import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { BindingsDraft, BindingsRow } from "./bindings-draft.js";
import { MUTED, ROW } from "./look.js";
import type { Target } from "./section-draft.js";
import { FormNote, type SaveNote } from "./settings-form.js";

// The bindings card of the tools group (ADR-096): one row per capability, its id and its adapters in
// fallback order. The scope switch and the save bar at the top and bottom of the screen move and save
// it with the forms, so the card has no target choice and no Save of its own.

/** The card's state, which the widget keeps. */
export type BindingsState = {
	readonly target: Target;
	/** The file the card edits now, or none when the global file is unknown. */
	readonly file?: string | undefined;
	readonly rows: BindingsDraft;
	readonly busy: boolean;
	readonly dirty: boolean;
	readonly note?: SaveNote | undefined;
};

/** What the card asks the widget for. */
export type BindingsActions = {
	readonly onRow: (
		index: number,
		key: "capability" | "adapters",
		value: string,
	) => void;
	readonly onAdd: () => void;
	readonly onRemove: (index: number) => void;
};

const COLUMN = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
} as const;

// Two fields and Remove, so a row reads as a line of the file it writes.
const LINE: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(160px, 1fr) minmax(160px, 1.4fr) auto",
	gap: "6px",
	alignItems: "center",
};

const capabilityWord = () =>
	nls.localize("mete/settings/capability", "Capability");

const adaptersWord = () =>
	nls.localize("mete/settings/adapters", "Adapters, in fallback order");

// The words over the columns, for the eye only: each field names itself for a screen reader.
const Head = () => (
	<div style={{ ...LINE, ...MUTED }} aria-hidden="true">
		<span>{capabilityWord()}</span>
		<span>{adaptersWord()}</span>
	</div>
);

const Row = ({
	index,
	row,
	actions,
}: {
	readonly index: number;
	readonly row: BindingsRow;
	readonly actions: BindingsActions;
}) => (
	<div style={LINE}>
		<input
			id={`mete-binding-${index}-capability`}
			className="mete-field"
			value={row.capability}
			aria-label={`${capabilityWord()} ${index + 1}`}
			placeholder="web.search@1"
			onChange={(e) => actions.onRow(index, "capability", e.target.value)}
		/>
		<input
			id={`mete-binding-${index}-adapters`}
			className="mete-field"
			value={row.adapters}
			aria-label={`${adaptersWord()} ${index + 1}`}
			placeholder="exa-mcp, tavily"
			onChange={(e) => actions.onRow(index, "adapters", e.target.value)}
		/>
		<button
			type="button"
			className="mete-button quiet"
			onClick={() => actions.onRemove(index)}
		>
			{nls.localize("mete/settings/remove", "Remove")}
		</button>
	</div>
);

/** The bindings section's card: its rows, Add, where it saves, and what the last save said. */
export const BindingsCard = ({
	state,
	actions,
}: {
	readonly state: BindingsState;
	readonly actions: BindingsActions;
}) => (
	<div style={{ ...COLUMN, gap: "8px" }}>
		<span style={MUTED}>
			{nls.localize(
				"mete/settings/bindingsHint",
				"One row per capability: its id, then the adapters METE tries in this order, for example web.search@1 → exa-mcp, tavily.",
			)}
		</span>
		{state.rows.length > 0 ? <Head /> : null}
		{state.rows.map((row, i) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: a row has no stable id while its capability is typed
			<Row key={i} index={i} row={row} actions={actions} />
		))}
		<div style={ROW}>
			<button
				type="button"
				className="mete-button quiet"
				onClick={actions.onAdd}
			>
				{nls.localize("mete/settings/addCapability", "Add capability")}
			</button>
		</div>
		<FormNote state={state} />
	</div>
);
