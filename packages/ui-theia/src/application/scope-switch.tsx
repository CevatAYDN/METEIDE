import { nls } from "@theia/core/lib/common/nls";
import { FIELD } from "./fields.js";
import { MUTED, ROW } from "./look.js";
import type { Target } from "./section-draft.js";

// The Settings screen's scope switch (ADR-095): where the forms below save, one choice for all of
// them. This folder stays the default (ADR-082); All folders needs the global file the daemon names.

const GROUP = { ...FIELD, border: 0, padding: 0, margin: 0, minWidth: 0 };

/** The switch; the target the forms save to is pressed. */
export const ScopeSwitch = (props: {
	readonly target: Target;
	readonly canGlobal: boolean;
	readonly onTarget: (target: Target) => void;
}) => (
	<fieldset style={GROUP}>
		<legend style={{ padding: 0 }}>
			{nls.localize("mete/settings/scope", "Save changes to")}
		</legend>
		<div style={ROW}>
			<button
				type="button"
				className="mete-button quiet"
				aria-pressed={props.target === "workspace"}
				onClick={() => props.onTarget("workspace")}
			>
				{nls.localize("mete/settings/scopeFolder", "This folder")}
			</button>
			<button
				type="button"
				className="mete-button quiet"
				disabled={!props.canGlobal}
				aria-pressed={props.target === "global"}
				onClick={() => props.onTarget("global")}
			>
				{nls.localize("mete/settings/scopeAll", "All folders")}
			</button>
		</div>
		<span style={MUTED}>
			{nls.localize(
				"mete/settings/scopeHint",
				"For the forms below; the custom endpoints card has its own choice.",
			)}
		</span>
	</fieldset>
);
