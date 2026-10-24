import { nls } from "@theia/core/lib/common/nls";
import { MUTED, ROW } from "./look.js";
import { shortPath } from "./settings-form.js";
import type { Forms } from "./settings-section.js";

// The Settings screen's one save bar (ADR-095): it saves every changed form, each to its own file,
// whichever group shows them. A form that has a problem is named by its file, since its own message is
// in a group that may not be on screen.

const BAR = {
	position: "sticky",
	bottom: 0,
	display: "flex",
	flexDirection: "column",
	gap: "6px",
} as const;

/** The save bar; Save changes waits for a change and for a save in flight. */
export const SaveBar = ({
	forms,
	onSave,
}: {
	readonly forms: Forms;
	readonly onSave: () => void;
}) => {
	const all = Object.entries(forms).flatMap(([name, f]) =>
		f ? [{ name, state: f.state }] : [],
	);
	const changed = all.filter((f) => f.state.dirty).map((f) => f.name);
	const problems = all.flatMap((f) =>
		f.state.note?.kind === "refused" && f.state.file
			? [shortPath(f.state.file)]
			: [],
	);
	const label = nls.localize("mete/settings/saveAll", "Save changes");
	return (
		<section className="mete-card" style={BAR} aria-label={label}>
			<div style={ROW}>
				<button
					type="button"
					className="mete-button"
					disabled={changed.length === 0 || all.some((f) => f.state.busy)}
					onClick={onSave}
				>
					{label}
				</button>
				<span style={MUTED}>
					{changed.length === 0
						? nls.localize("mete/settings/barNone", "No unsaved changes")
						: nls.localize(
								"mete/settings/barChanged",
								"Unsaved changes: {0}",
								changed.join(", "),
							)}
				</span>
			</div>
			{problems.map((file) => (
				<span key={file} role="alert">
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
