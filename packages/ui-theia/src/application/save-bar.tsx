import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import { Icon } from "./roster-look.js";
import type { Target } from "./section-draft.js";
import { type SaveNote, shortPath } from "./settings-form.js";

// The Settings screen's one save bar (ADR-095): it saves every changed form, each to its own file,
// whichever group shows them. A form that has a problem is named by its file, since its own message is
// in a group that may not be on screen.

/** What the bar needs of a form or a card that saves to a file (ADR-095, ADR-096). */
export type Saveable = {
	readonly state: {
		readonly target: Target;
		readonly file?: string | undefined;
		readonly busy: boolean;
		readonly dirty: boolean;
		readonly note?: SaveNote | undefined;
	};
};

/** A form with the name the bar prints for it: its section's id. */
export type SaveEntry = readonly [name: string, form: Saveable];

/** The save bar; Save changes waits for a change and for a save in flight. What else the screen
 * applies (Apply now, ADR-083) follows it, past a rule. Laid out by style/mete-settings.css. */
export const SaveBar = ({
	entries,
	onSave,
	children,
}: {
	readonly entries: readonly SaveEntry[];
	readonly onSave: () => void;
	readonly children?: ReactNode;
}) => {
	const changed = entries
		.filter(([, f]) => f.state.dirty)
		.map(([name]) => name);
	const problems = entries.flatMap(([, f]) =>
		f.state.note?.kind === "refused" && f.state.file
			? [shortPath(f.state.file)]
			: [],
	);
	const label = nls.localize("mete/settings/saveAll", "Save changes");
	return (
		<section className="mete-save-bar" aria-label={label}>
			<span className="mete-save-bar-tile">
				<Icon name="save" />
			</span>
			<p>
				{changed.length === 0
					? nls.localize("mete/settings/barNone", "No unsaved changes")
					: nls.localize(
							"mete/settings/barChanged",
							"Unsaved changes: {0}",
							changed.join(", "),
						)}
			</p>
			<button
				type="button"
				className="mete-button"
				disabled={changed.length === 0 || entries.some(([, f]) => f.state.busy)}
				onClick={onSave}
			>
				<Icon name="check" />
				{label}
			</button>
			{children ? (
				<>
					<span className="mete-save-bar-rule" aria-hidden="true" />
					{children}
				</>
			) : null}
			{problems.map((file) => (
				<span key={file} className="mete-save-bar-problem" role="alert">
					{nls.localize(
						"mete/settings/barProblem",
						"A problem with {0}: its form says why.",
						file,
					)}
				</span>
			))}
		</section>
	);
};
