import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import type { Target } from "./section-draft.js";

// The Settings screen's scope switch (ADR-095): where the forms below save, one choice for all of
// them. This folder stays the default (ADR-082); All folders needs the global file the daemon names.
// A segmented control (ADR-127), laid out by style/mete-settings.css.

/** The switch; the target the forms save to is pressed. */
export const ScopeSwitch = (props: {
	readonly target: Target;
	readonly canGlobal: boolean;
	readonly onTarget: (target: Target) => void;
}) => (
	<fieldset className="mete-settings-scope">
		<legend>{nls.localize("mete/settings/scope", "Save changes to")}</legend>
		<div className="mete-segmented">
			<button
				type="button"
				aria-pressed={props.target === "workspace"}
				onClick={() => props.onTarget("workspace")}
			>
				<Icon name="folder" />
				{nls.localize("mete/settings/scopeFolder", "This folder")}
			</button>
			<button
				type="button"
				disabled={!props.canGlobal}
				aria-pressed={props.target === "global"}
				onClick={() => props.onTarget("global")}
			>
				<Icon name="globe" />
				{nls.localize("mete/settings/scopeAll", "All folders")}
			</button>
		</div>
		<p>
			{nls.localize(
				"mete/settings/scopeHint",
				"For the forms below; the custom endpoints card has its own choice.",
			)}
		</p>
	</fieldset>
);
